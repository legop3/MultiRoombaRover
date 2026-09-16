// Exercise metadata discovery and writes without opening any network connection.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEntity, buildCommand } = require('./entityHelpers');
const { matchesFilter } = require('./capabilities');
const { createActions } = require('./actions');
const { createLocks, resolveItem } = require('./locks');
const { createHaCommand } = require('../operatorCommandService/commands/ha');
const { services } = require('./testFixtures/services');
const { assertValidConfig, normalizeConfig } = require('../../configuration/validation');

const user = { role: 'user', mode: 'open' };
const raw = (state, attributes = {}) => ({ state, attributes });
const entity = (id, state, attributes = {}, config = {}) => buildEntity({ id, ...config }, raw(state, attributes), services);
const getField = (item, service, key) => item.actions.find((action) => action.service === service)?.fields.find((field) => field.key === key);
function harness(items, snapshot) {
  const calls = [];
  const config = { enabled: true, items };
  const locked = new Set();
  const ha = {
    enabled: true, isConnected: () => true,
    getServiceDescriptions: () => services,
    getRawEntitySnapshot: (id) => snapshot[id],
    callHomeAssistantService: async (...args) => { calls.push(args); },
  };
  return { config, ha, calls, locked, actions: createActions({ getConfig: () => config, ha, locks: { isLocked: (id) => locked.has(id) } }) };
}

test('sensor values and configured colors remain independent of writable capabilities', () => {
  const sensor = entity('sensor.humidity', '46.3', { unit_of_measurement: '%', friendly_name: 'Humidity' }, { color: '#cc4488' });
  assert.equal(sensor.state, '46.3');
  assert.equal(sensor.unit, '%');
  assert.equal(sensor.name, 'Humidity');
  assert.equal(sensor.color, '#cc4488');
  assert.deepEqual(sensor.actions, []);
  assert.equal(entity('button.bell', 'unknown').available, true);
  assert.equal(entity('button.bell', 'unavailable').available, false);
  assert.equal(buildEntity({ id: 'button.bell' }, null, services).available, false);
  assert.deepEqual(entity('fan.room', 'on', { supported_features: 15 }, { readOnly: true }).actions, []);
});

test('fan fields follow live features, percentages, options, and irregular state names', () => {
  const fan = entity('fan.room', 'on', { supported_features: 15, percentage: 50, percentage_step: 25,
    oscillating: true, current_direction: 'reverse', preset_mode: 'auto', preset_modes: ['auto', 'sleep'] });
  assert.equal(getField(fan, 'set_percentage', 'percentage').step, 25);
  assert.equal(getField(fan, 'set_percentage', 'percentage').state, 50);
  assert.equal(getField(fan, 'oscillate', 'oscillating').state, true);
  assert.equal(getField(fan, 'set_direction', 'direction').state, 'reverse');
  assert.deepEqual(getField(fan, 'set_preset_mode', 'preset_mode').options.map((option) => option.value), ['auto', 'sleep']);
  assert.ok(!entity('fan.simple', 'off', { supported_features: 1 }).actions.some((action) => action.service === 'oscillate'));
  assert.deepEqual(buildCommand(fan, 'fan.oscillate', { oscillating: false }), { domain: 'fan', service: 'oscillate', data: { oscillating: false, entity_id: 'fan.room' } });
});

test('climate ranges use entity limits, nested fields, companion values, and live modes', () => {
  const climate = entity('climate.room', 'heat_cool', { supported_features: 10, min_temp: 16, max_temp: 28,
    target_temp_step: 0.5, target_temp_low: 18, target_temp_high: 24, hvac_modes: ['off', 'heat_cool'], fan_modes: ['auto', 'low'], fan_mode: 'auto' });
  const low = getField(climate, 'set_temperature', 'target_temp_low');
  assert.deepEqual([low.min, low.max, low.step, low.required], [16, 28, 0.5, true]);
  assert.equal(getField(climate, 'set_temperature', 'temperature'), undefined);
  assert.equal(getField(climate, 'set_hvac_mode', 'hvac_mode').state, 'heat_cool');
  assert.equal(getField(climate, 'set_temperature', 'hvac_mode').hidden, true);
  assert.throws(() => buildCommand(climate, 'climate.set_temperature', { target_temp_low: 19 }), /required/);
  const command = buildCommand(climate, 'climate.set_temperature', { target_temp_low: 19, target_temp_high: 25 });
  assert.deepEqual(command.data, { entity_id: 'climate.room', target_temp_low: 19, target_temp_high: 25 });
  assert.throws(() => buildCommand(climate, 'climate.set_temperature', { target_temp_low: 10, target_temp_high: 25 }), /range/);
});

test('covers, media players, vacuums, and lights use the same service discovery', () => {
  const cover = entity('cover.blind', 'open', { supported_features: 15, current_position: 40 });
  assert.equal(getField(cover, 'set_cover_position', 'position').state, 40);
  assert.equal(buildCommand(cover, 'cover.close_cover', {}).service, 'close_cover');
  const player = entity('media_player.room', 'playing', { supported_features: 4 | 8 | 2048 | 512 | 1 | 16384,
    volume_level: 0.3, is_volume_muted: false, source: 'Radio', source_list: ['Radio', 'TV'] });
  assert.equal(getField(player, 'volume_set', 'volume_level').state, 0.3);
  assert.equal(getField(player, 'select_source', 'source').options.length, 2);
  assert.ok(player.actions.some((action) => action.service === 'media_play_pause'));
  assert.ok(player.unsupported.includes('Play media'));
  const vacuum = entity('vacuum.robot', 'docked', { supported_features: 8192 | 16, fan_speed: 'quiet', fan_speed_list: ['quiet', 'max'] });
  assert.equal(buildCommand(vacuum, 'vacuum.return_to_base', {}).service, 'return_to_base');
  assert.equal(getField(vacuum, 'set_fan_speed', 'fan_speed').state, 'quiet');
  const light = entity('light.room', 'on', { brightness: 128, rgb_color: [20, 40, 60], supported_color_modes: ['rgb'] });
  assert.equal(getField(light, 'turn_on', 'brightness_pct').state, 50);
  assert.equal(getField(light, 'turn_on', 'rgb_color').type, 'color');
  assert.equal(getField(light, 'turn_on', 'color_temp_kelvin'), undefined);
  assert.deepEqual(buildCommand(light, 'light.turn_on', { rgb_color: [1, 2, 3] }).data, { entity_id: 'light.room', rgb_color: [1, 2, 3] });
});

test('new integration domains work from selectors without a domain implementation', () => {
  const custom = entity('custom.device', 'active', { level: 2, mode: 'eco' });
  assert.equal(custom.actions.length, 1);
  assert.equal(custom.actions[0].fields[1].options[0].label, 'Economy');
  assert.deepEqual(buildCommand(custom, 'custom.adjust', { level: 3, mode: 'eco' }).data, { entity_id: 'custom.device', level: 3, mode: 'eco' });
  assert.throws(() => buildCommand(custom, 'custom.reload', {}), /not available/);
  const fan = entity('fan.room', 'on');
  assert.equal(buildCommand(fan, 'custom.fan_reset', {}).domain, 'custom');
  assert.ok(!custom.actions.some((action) => action.service === 'fan_reset'));
});

test('filter semantics preserve OR, nested AND, attributes, and domain boundaries', () => {
  assert.equal(matchesFilter({ supported_features: [[1, 2], 8] }, 'fan', { supported_features: 1 }), false);
  assert.equal(matchesFilter({ supported_features: [[1, 2], 8] }, 'fan', { supported_features: 3 }), true);
  assert.equal(matchesFilter({ supported_features: [[1, 2], 8] }, 'fan', { supported_features: 8 }), true);
  assert.equal(matchesFilter({ attribute: { supported_color_modes: ['rgb'] } }, 'light', { supported_color_modes: ['hs'] }), false);
  assert.equal(matchesFilter([{ domain: 'fan' }, { domain: 'light' }], 'light', {}), true);
  assert.equal(matchesFilter({ domain: 'fan' }, 'switch', {}), false);
});

test('simple helpers use metadata and entity-specific limits without room-light dispatch', () => {
  const number = entity('number.speed', '0', { min: 0, max: 1, step: 0.1 });
  assert.equal(getField(number, 'set_value', 'value').type, 'number');
  for (const value of ['', null, false, {}, Infinity, 2]) assert.throws(() => buildCommand(number, 'number.set_value', { value }));
  assert.equal(buildCommand(number, 'number.set_value', { value: '0.3' }).data.value, 0.3);
  const text = entity('text.code', 'ab', { min: 2, max: 4 });
  for (const value of ['', 'abcde', 123]) assert.throws(() => buildCommand(text, 'text.set_value', { value }));
  assert.equal(buildCommand(text, 'text.set_value', { value: '12' }).data.value, '12');
  const select = entity('select.mode', 'Quiet', { options: ['Quiet', 'Normal'] });
  assert.throws(() => buildCommand(select, 'select.select_option', { option: 'Other' }));
  assert.equal(buildCommand(entity('button.bell', 'unknown'), 'button.press').service, 'press');
});

test('permissions, allowlist, locks, availability, and service payloads remain authoritative', async () => {
  const h = harness([{ id: 'switch.fan' }], { 'switch.fan': raw('on') });
  await assert.rejects(h.actions.act('switch.room_only', 'switch.turn_off', {}, user), /Unknown/);
  for (const actor of [{ role: 'spectator', mode: 'open' }, { role: 'user', mode: 'admin' }, { role: 'admin', mode: 'lockdown' }]) {
    await assert.rejects(h.actions.act('switch.fan', 'switch.turn_off', {}, actor));
  }
  await assert.rejects(h.actions.act('switch.fan', 'switch.turn_off', { entity_id: 'switch.other' }, user), /Unknown action field/);
  await assert.rejects(h.actions.act('switch.fan', 'custom.reload', {}, user), /not available/);
  h.locked.add('switch.fan');
  await assert.rejects(h.actions.act('switch.fan', 'switch.turn_off', {}, user), /locked/);
  assert.equal(h.calls.length, 0);
  await h.actions.act('switch.fan', 'switch.turn_off', {}, { role: 'admin', mode: 'open' });
  assert.deepEqual(h.calls[0], ['switch', 'turn_off', { entity_id: 'switch.fan' }]);
  h.ha.isConnected = () => false;
  await assert.rejects(h.actions.act('switch.fan', 'switch.turn_off', {}, { role: 'admin', mode: 'open' }), /offline/);
});

test('idle invokes discovered actions, ignores locks, and isolates per-item failures', async () => {
  const h = harness([
    { id: 'switch.keep' },
    { id: 'number.bad', idleAction: 'set_value', idleValue: '200' },
    { id: 'switch.fan', idleAction: 'turn_off' },
    { id: 'text.message', idleAction: 'set_value' },
    { id: 'button.stop', idleAction: 'press' },
    { id: 'climate.room', idleAction: 'climate.set_temperature', idleValue: '{"target_temp_low":18,"target_temp_high":24}' },
    { id: 'switch.readonly', readOnly: true, idleAction: 'turn_off' },
  ], {
    'number.bad': raw('0', { min: 0, max: 10 }), 'switch.fan': raw('on'),
    'text.message': raw('Welcome', { min: 0, max: 30 }), 'button.stop': raw('unknown'),
    'climate.room': raw('heat_cool', { supported_features: 2, min_temp: 16, max_temp: 28 }),
  });
  h.locked.add('switch.fan');
  const result = await h.actions.runIdleActions();
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results.filter((entry) => entry.ok).length, 4);
  assert.deepEqual(h.calls.map((call) => call[2]), [{ entity_id: 'switch.fan' }, { value: '', entity_id: 'text.message' },
    { entity_id: 'button.stop' }, { target_temp_low: 18, target_temp_high: 24, entity_id: 'climate.room' }]);
});

test('actions do not wait for an earlier response to send a later change', async () => {
  const h = harness([{ id: 'switch.fan' }], { 'switch.fan': raw('off') });
  const completions = [];
  h.ha.callHomeAssistantService = () => new Promise((resolve) => { completions.push(resolve); });
  const first = h.actions.act('switch.fan', 'switch.turn_on', {}, user);
  const second = h.actions.act('switch.fan', 'switch.turn_off', {}, user);
  assert.equal(completions.length, 2);
  completions.forEach((finish) => finish());
  await Promise.all([first, second]);
});

test('locks remain process-local and names resolve without guessing', () => {
  const locks = createLocks();
  locks.setLocked('number.fan', true);
  assert.equal(locks.isLocked('number.fan'), true);
  assert.equal(createLocks().isLocked('number.fan'), false);
  locks.setLocked('number.fan', false);
  assert.equal(locks.isLocked('number.fan'), false);
  const items = [{ id: 'number.fan', name: 'Fan speed' }, { id: 'number.other', name: 'Fan speed' }];
  assert.equal(resolveItem(items.slice(0, 1), 'FAN SPEED').id, 'number.fan');
  assert.equal(resolveItem(items, 'NUMBER.FAN').id, 'number.fan');
  assert.throws(() => resolveItem(items, 'Fan speed'), /number.fan, number.other/);
});

test('command names and the normal schema configuration flow remain unchanged', async () => {
  const changes = [];
  const handler = createHaCommand({ config: { commands: { prefix: 'rs' } }, homeAssistantActivitiesService: {
    setLocked: (name, locked) => { changes.push([name, locked]); return { id: 'number.fan', name }; },
  } });
  await handler({ reply() {} }, ['lock', 'Fan', 'speed']);
  assert.deepEqual(changes, [['Fan speed', true]]);
  const config = normalizeConfig({ homeAssistantActivities: { enabled: true, items: [{ id: 'fan.room', color: '#ab12Cd', idleAction: 'turn_off' }] } });
  assertValidConfig(config);
  config.homeAssistantActivities.items[0].color = 'red';
  assert.throws(() => assertValidConfig(config));
});
