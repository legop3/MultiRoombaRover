// Neato Feature Command Tests
// Purpose: Pins the public Neato status report and its intentionally small control vocabulary.
// Scope: Uses a service double so hardware, Home Assistant, and access-mode behavior remain in their owning tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNeatoCommand } = require('./neato');

function createHarness(state = {}) {
  const replies = [];
  const calls = [];
  const neatoService = {
    getState: () => state,
    startCleaning: async () => calls.push(['start']),
    sendHome: async () => calls.push(['home']),
    locateRobot: async () => calls.push(['sound']),
    clearErrors: async () => calls.push(['clear']),
    setNavigationMode: async (mode) => calls.push(['navigation', mode]),
  };
  const handler = createNeatoCommand({ neatoService, sanitizeMentions: String });
  const message = {
    actor: { id: 'test-user' },
    reply: async (payload) => replies.push(payload.content),
  };
  return { handler, message, replies, calls };
}

test('status reports the canonical battery fields and every raw UI status value', async () => {
  const state = {
    connected: true,
    telemetry: {
      batteryPercent: 82,
      batteryVoltage: 14.671,
      robotAlert: '200 (UI_ALERT_NONE)',
      robotError: '200 (UI_ERROR_NONE)',
      robotState: 'ROBOT_STATE_HOUSECLEANING',
      uiState: 'UIMGR_STATE_HOUSECLEANINGRUNNING',
    },
  };
  const { handler, message, replies } = createHarness(state);

  await handler(message, ['status']);

  assert.equal(replies[0], [
    'Neato: connected',
    'Battery: 82%',
    'Battery voltage: 14.67 V',
    'Robot alert: 200 (UI_ALERT_NONE)',
    'Robot error: 200 (UI_ERROR_NONE)',
    'Robot state: ROBOT_STATE_HOUSECLEANING',
    'UI state: UIMGR_STATE_HOUSECLEANINGRUNNING',
  ].join('\n'));
});

test('bare neato status uses unknown only for values the service did not provide', async () => {
  const { handler, message, replies } = createHarness({ connected: false, telemetry: {} });

  await handler(message, []);

  assert.match(replies[0], /^Neato: offline\nBattery: unknown\nBattery voltage: unknown/m);
  assert.match(replies[0], /Robot alert: unknown/);
  assert.match(replies[0], /UI state: unknown/);
});

test('sound and clear are the only names for their renamed actions', async () => {
  const { handler, message, replies, calls } = createHarness();

  await handler(message, ['sound']);
  await handler(message, ['clear']);
  await handler(message, ['locate']);
  await handler(message, ['clear-errors']);

  assert.deepEqual(calls, [['sound'], ['clear']]);
  assert.match(replies[2], /Invalid Neato command/);
  assert.match(replies[3], /Invalid Neato command/);
});

test('navigation normalizes command input to the exact service option', async () => {
  const { handler, message, replies, calls } = createHarness();

  await handler(message, ['navigation', 'gEnTlE']);

  assert.deepEqual(calls, [['navigation', 'Gentle']]);
  assert.equal(replies[0], 'Neato navigation mode set to Gentle.');
});

test('navigation rejects missing, unknown, and extra arguments', async () => {
  const { handler, message, replies, calls } = createHarness();

  await handler(message, ['navigation']);
  await handler(message, ['navigation', 'turbo']);
  await handler(message, ['navigation', 'normal', 'extra']);

  assert.deepEqual(calls, []);
  assert.equal(replies.length, 3);
  for (const reply of replies) assert.match(reply, /navigation normal/);
});
