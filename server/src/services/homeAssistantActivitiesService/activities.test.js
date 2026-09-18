// Exercise contracts without starting the app or connecting to Home Assistant.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEntity, buildCommand } = require('./entityHelpers');
const { createActions } = require('./actions');
const { createLocks, resolveItem } = require('./locks');
const { createHaCommand } = require('../operatorCommandService/commands/ha');

const user = { role: 'user', mode: 'open' };
const raw = (state, attributes = {}) => ({ state, attributes });
function harness(items, snapshot) {
  const calls = [];
  const config = { enabled: true, items };
  const locked = new Set();
  const ha = {
    enabled: true, isConnected: () => true,
    getRawEntitySnapshot: (id) => snapshot[id],
    callHomeAssistantService: async (...args) => { calls.push(args); },
  };
  return { config, ha, calls, locked, actions: createActions({ getConfig: () => config, ha, locks: { isLocked: (id) => locked.has(id) } }) };
}

test('sensor states, live constraints, and unknown button states are preserved', () => {
  const sensor = buildEntity({ id: 'sensor.humidity' }, raw('46.3', { unit_of_measurement: '%', friendly_name: 'Humidity' }));
  assert.equal(sensor.state, '46.3');
  assert.equal(sensor.unit, '%');
  assert.equal(sensor.type, 'readOnly');
  assert.equal(sensor.name, 'Humidity');
  assert.equal(buildEntity({ id: 'button.bell' }, raw('unknown')).available, true);
  assert.equal(buildEntity({ id: 'button.bell' }, raw('unavailable')).available, false);
  assert.equal(buildEntity({ id: 'button.bell' }, null).available, false);
  assert.equal(buildEntity({ id: 'switch.fan', readOnly: true }, raw('on')).type, 'readOnly');
});

test('domain dispatch handles native entities and helpers without room-light payloads', async () => {
  const cases = [
    ['light.lamp', 'on', {}, 'turn_on', {}],
    ['switch.fan', 'off', {}, 'turn_off', {}],
    ['input_boolean.enabled', 'on', {}, 'turn_on', {}],
    ['number.speed', 0.3, { min: 0, max: 1, step: 0.1 }, 'set_value', { value: 0.3 }],
    ['input_number.speed', '2', { min: 0, max: 5, step: 1 }, 'set_value', { value: 2 }],
    ['text.message', 'hello', { min: 0, max: 20 }, 'set_value', { value: 'hello' }],
    ['input_text.message', '', { min: 0, max: 20 }, 'set_value', { value: '' }],
    ['select.mode', 'Quiet', { options: ['Quiet'] }, 'select_option', { option: 'Quiet' }],
    ['input_select.mode', 'Quiet', { options: ['Quiet'] }, 'select_option', { option: 'Quiet' }],
    ['button.bell', 'press', {}, 'press', {}],
    ['input_button.bell', 'press', {}, 'press', {}],
  ];
  // Each domain is exercised through the allowlist and action service rather
  // than merely asserting that an internal mapping table contains an entry.
  for (const [id, value, attributes, service, data] of cases) {
    const h = harness([{ id }], { [id]: raw('unknown', attributes) });
    if (!id.includes('button')) h.ha.getRawEntitySnapshot = () => raw('off', attributes);
    await h.actions.act(id, value, user);
    assert.deepEqual(h.calls, [[id.split('.')[0], service, { entity_id: id, ...data }]]);
  }
});

test('invalid values fail before an outbound request', () => {
  const number = buildEntity({ id: 'number.speed' }, raw('0', { min: 0, max: 1, step: 0.1 }));
  for (const value of ['', ' ', null, false, {}, Infinity, 'NaN', 2, 0.15]) assert.throws(() => buildCommand(number, value));
  const text = buildEntity({ id: 'text.code' }, raw('ab', { min: 2, max: 4, pattern: '[a-z]+' }));
  for (const value of ['', 'abcde', 123]) assert.throws(() => buildCommand(text, value));
  // Pattern interpretation belongs to HA, even when metadata supplies one.
  assert.equal(buildCommand(text, '12').data.value, '12');
  assert.throws(() => buildCommand(buildEntity({ id: 'select.mode' }, raw('Quiet', { options: ['Quiet'] })), 'Other'));
  assert.throws(() => buildCommand(buildEntity({ id: 'sensor.state' }, raw('ok')), 'on'), /read-only/);
});

test('permissions, locks, availability and allowlist are authoritative', async () => {
  const h = harness([{ id: 'switch.fan' }], { 'switch.fan': raw('on') });
  await assert.rejects(h.actions.act('switch.room_only', 'off', user), /Unknown/);
  for (const actor of [{ role: 'spectator', mode: 'open' }, { role: 'user', mode: 'admin' }, { role: 'admin', mode: 'lockdown' }]) {
    await assert.rejects(h.actions.act('switch.fan', 'off', actor));
  }
  h.locked.add('switch.fan');
  await assert.rejects(h.actions.act('switch.fan', 'off', user), /locked/);
  assert.equal(h.calls.length, 0);
  await h.actions.act('switch.fan', 'off', { role: 'admin', mode: 'open' });
  await h.actions.act('switch.fan', 'off', { role: 'lockdown', mode: 'lockdown' });
  h.ha.isConnected = () => false;
  await assert.rejects(h.actions.act('switch.fan', 'off', { role: 'admin', mode: 'open' }), /offline/);
  h.config.enabled = false;
  await assert.rejects(h.actions.act('switch.fan', 'off', user), /disabled/);
});

test('idle ignores user locks, preserves no-op items, and isolates failures', async () => {
  const h = harness([
    { id: 'switch.keep' },
    { id: 'number.bad', idleAction: 'set', idleValue: '200' },
    { id: 'switch.fan', idleAction: 'set', idleValue: 'off' },
    // An empty optional text box is omitted by the schema-driven admin form.
    { id: 'input_text.message', idleAction: 'set' },
    { id: 'input_button.stop', idleAction: 'press' },
    { id: 'sensor.humidity', idleAction: 'set', idleValue: '0' },
    { id: 'switch.readonly', readOnly: true, idleAction: 'set', idleValue: 'off' },
  ], {
    'number.bad': raw('0', { min: 0, max: 10 }), 'switch.fan': raw('on'),
    'input_text.message': raw('Welcome', { min: 0, max: 30 }), 'input_button.stop': raw('unknown'),
  });
  h.locked.add('switch.fan');
  const result = await h.actions.runIdleActions();
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results.filter((entry) => entry.ok).length, 3);
  assert.deepEqual(h.calls.map((call) => call[2]), [{ entity_id: 'switch.fan' }, { entity_id: 'input_text.message', value: '' }, { entity_id: 'input_button.stop' }]);
});

test('an outstanding service response does not block later commands', async () => {
  const h = harness([{ id: 'switch.fan' }], { 'switch.fan': raw('off') });
  const completions = [];
  h.ha.callHomeAssistantService = () => new Promise((resolve) => { completions.push(resolve); });
  const first = h.actions.act('switch.fan', 'on', user);
  const second = h.actions.act('switch.fan', 'off', user);
  // Both commands reach HA before either response arrives.
  assert.equal(completions.length, 2);
  completions.forEach((finish) => finish());
  await Promise.all([first, second]);
});

test('locks are process-local and names resolve without guessing', () => {
  const locks = createLocks();
  locks.setLocked('number.fan', true);
  assert.equal(locks.isLocked('number.fan'), true);
  // A fresh service starts unlocked instead of restoring previous moderation.
  assert.equal(createLocks().isLocked('number.fan'), false);
  locks.setLocked('number.fan', false);
  assert.equal(locks.isLocked('number.fan'), false);
  const items = [{ id: 'number.fan', name: 'Fan speed' }, { id: 'number.other', name: 'Fan speed' }];
  assert.equal(resolveItem(items.slice(0, 1), 'FAN SPEED').id, 'number.fan');
  assert.equal(resolveItem(items, 'NUMBER.FAN').id, 'number.fan');
  assert.throws(() => resolveItem(items, 'Fan speed'), /number.fan, number.other/);
  // Keep the lookup error aligned with the panel name users see when choosing an item.
  assert.throws(() => resolveItem(items, 'Fan'), /No activity control/);
});

test('command preserves multiword names and exposes lock status', async () => {
  const changes = [];
  const replies = [];
  const handler = createHaCommand({ config: { commands: { prefix: 'rs' } }, homeAssistantActivitiesService: {
    setLocked: (name, locked) => { changes.push([name, locked]); return { id: 'number.fan', name }; },
    getState: () => ({ items: [{ id: 'number.fan', name: 'Fan speed', locked: true }] }),
  } });
  const message = { reply: (reply) => { replies.push(reply.content); } };
  await handler(message, ['lock', 'Fan', 'speed']);
  await handler(message, ['status']);
  assert.deepEqual(changes, [['Fan speed', true]]);
  assert.match(replies[1], /Fan speed \(number.fan\): locked/);
});
