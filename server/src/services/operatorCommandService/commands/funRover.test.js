// Operator Fun Rover Command Tests
// Purpose: Verifies the control, feature, and lock checks the hardware-backed fun commands must make themselves.
// Scope: issueCommand, roverManager, and Home Assistant are all doubles; no real rover or timer is involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFunRoverCommands, describeBattery } = require('./funRover');
const { createCooldownGate } = require('../cooldowns');

const ALICE = { id: 's1', data: { userId: 'u-alice', nickname: 'alice' } };
const BOB = { id: 's2', data: { userId: 'u-bob', nickname: 'bob' } };

function createHarness({
  canDrive = true,
  socket = ALICE,
  hornEnabled = true,
  ttsEnabled = true,
  online = true,
  maxWheelSpeed = 300,
  privateSafetyDrive = null,
  activeDrivers = {},
  homeAssistantService = null,
  featureEnabled = false,
  sockets = [ALICE, BOB],
} = {}) {
  const issued = [];
  const record = {
    id: 'rover-1',
    ws: online ? {} : null,
    locked: false,
    meta: {
      name: 'Roomba One',
      maxWheelSpeed,
      horn: { enabled: hornEnabled },
      audio: { ttsEnabled },
    },
    batteryState: { percentDisplay: 74, warnActive: false, urgentActive: false },
  };
  const rovers = new Map([['rover-1', record]]);

  const handlers = createFunRoverCommands({
    io: { sockets: { sockets: new Map(sockets.map((entry) => [entry.id, entry])) } },
    rovers,
    roverManager: {
      canDrive: () => canDrive,
      getPrimaryRoverForSocket: () => 'rover-1',
      applyPrivateDriveSafety: () => privateSafetyDrive,
    },
    getNickname: (entry) => entry?.data?.nickname || '',
    getActiveDrivers: () => activeDrivers,
    getActorSocket: () => socket,
    issueCommand: (roverId, payload) => {
      if (!record.ws) throw new Error('Rover offline');
      issued.push({ roverId, ...payload });
      return 'cmd-1';
    },
    homeAssistantService,
    isFeatureEnabled: () => featureEnabled,
    sanitizeMentions: (text) => String(text || '').replace(/@everyone/gi, '[everyone]'),
    cooldowns: createCooldownGate(),
    logger: { warn: () => {} },
    config: { commands: { prefix: 'rs' } },
  });

  return { handlers, issued, record, rovers };
}

function message(actor = { id: 's1', userId: 'u-alice', label: 'alice' }) {
  const replies = [];
  return {
    transport: 'web-chat',
    actor,
    replies,
    reply: async (payload) => {
      replies.push(payload);
      return null;
    },
  };
}

test('honk starts the horn and schedules a stop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { handlers, issued } = createHarness();
  const msg = message();
  await handlers.honk(msg, []);

  assert.match(msg.replies[0].content, /HONK/);
  assert.deepEqual(issued.map((entry) => entry.horn.action), ['start']);

  // The stop is deferred, so nothing has released the horn yet.
  t.mock.timers.tick(1000);
  assert.deepEqual(issued.map((entry) => entry.horn.action), ['start', 'stop']);
});

test('honk is refused without drive control', async () => {
  const { handlers, issued } = createHarness({ canDrive: false });
  const msg = message();
  await handlers.honk(msg, []);

  assert.match(msg.replies[0].content, /need control of Roomba One/);
  assert.equal(issued.length, 0);
});

test('honk is refused from a transport with no socket, so Discord cannot drive hardware', async () => {
  const { handlers, issued } = createHarness({ socket: null });
  const msg = message({ id: '4242', label: 'DiscordUser' });
  await handlers.honk(msg, []);

  assert.match(msg.replies[0].content, /only works from site chat/);
  assert.equal(issued.length, 0);
});

test('honk is refused on a rover with no horn fitted', async () => {
  const { handlers, issued } = createHarness({ hornEnabled: false });
  const msg = message();
  await handlers.honk(msg, []);

  assert.match(msg.replies[0].content, /no horn fitted/);
  assert.equal(issued.length, 0);
});

test('a second driver cannot bypass the rover cooldown with their own fresh actor window', async () => {
  const { handlers, issued } = createHarness();
  await handlers.honk(message(), []);

  const other = message({ id: 's2', userId: 'u-bob', label: 'bob' });
  await handlers.honk(other, []);
  assert.match(other.replies[0].content, /was just honked/);
  // Only the first honk reached the rover.
  assert.equal(issued.filter((entry) => entry.horn?.action === 'start').length, 1);
});

test('an offline rover reports offline instead of claiming a honk happened', async () => {
  const { handlers } = createHarness({ online: false });
  const msg = message();
  await handlers.honk(msg, []);
  assert.match(msg.replies[0].content, /is offline/);
});

test('spin clamps to the rover wheel speed ceiling and always stops itself', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { handlers, issued } = createHarness({ maxWheelSpeed: 50 });
  const msg = message();
  await handlers.spin(msg, []);

  assert.equal(issued[0].driveDirect.left, 50);
  assert.equal(issued[0].driveDirect.right, -50);

  t.mock.timers.tick(2000);
  assert.deepEqual(issued[1].driveDirect, { left: 0, right: 0 });
});

test('spin honours a private rover safety override rather than bypassing it', async () => {
  const { handlers, issued } = createHarness({ privateSafetyDrive: { left: 20, right: -20 } });
  await handlers.spin(message(), []);
  assert.deepEqual(issued[0].driveDirect, { left: 20, right: -20 });
});

test('spin is refused without drive control', async () => {
  const { handlers, issued } = createHarness({ canDrive: false });
  const msg = message();
  await handlers.spin(msg, []);
  assert.match(msg.replies[0].content, /need control/);
  assert.equal(issued.length, 0);
});

test('boo speaks a canned taunt rather than any caller supplied text', async () => {
  const { handlers, issued } = createHarness({ activeDrivers: { 'rover-1': 's2' } });
  const msg = message();
  await handlers.boo(msg, ['bob']);

  assert.equal(issued.length, 1);
  assert.equal(issued[0].type, 'tts');
  // The spoken text must not contain anything the caller typed.
  assert.doesNotMatch(issued[0].tts.text, /bob/i);
  assert.ok(issued[0].tts.text.length > 0);
});

test('boo is refused when the target is not driving anything', async () => {
  const { handlers, issued } = createHarness({ activeDrivers: {} });
  const msg = message();
  await handlers.boo(msg, ['bob']);

  assert.match(msg.replies[0].content, /not driving anything/);
  assert.equal(issued.length, 0);
});

test('boo is refused when the target is not online at all', async () => {
  const { handlers, issued } = createHarness({ sockets: [ALICE] });
  const msg = message();
  await handlers.boo(msg, ['nobody-here']);

  assert.match(msg.replies[0].content, /not here to be booed/);
  assert.equal(issued.length, 0);
});

test('boo is refused on a rover that cannot speak', async () => {
  const { handlers, issued } = createHarness({ ttsEnabled: false, activeDrivers: { 'rover-1': 's2' } });
  const msg = message();
  await handlers.boo(msg, ['bob']);

  assert.match(msg.replies[0].content, /cannot speak/);
  assert.equal(issued.length, 0);
});

test('disco is unavailable when the Home Assistant feature is off', async () => {
  const calls = [];
  const { handlers } = createHarness({
    featureEnabled: false,
    homeAssistantService: {
      getLightPolicyState: () => ({}),
      setAllControllableEntitiesState: (state) => calls.push(state),
    },
  });
  const msg = message();
  await handlers.disco(msg, []);

  assert.match(msg.replies[0].content, /unavailable/);
  assert.equal(calls.length, 0);
});

test('disco obeys the room light lock', async () => {
  const calls = [];
  const { handlers } = createHarness({
    featureEnabled: true,
    homeAssistantService: {
      getLightPolicyState: () => ({ locked: true, lockState: 'on' }),
      setAllControllableEntitiesState: (state) => calls.push(state),
    },
  });
  const msg = message();
  await handlers.disco(msg, []);

  assert.match(msg.replies[0].content, /locked/);
  assert.equal(calls.length, 0);
});

test('disco strobes while unlocked and restores the lights on when it ends', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const calls = [];
  const { handlers } = createHarness({
    featureEnabled: true,
    homeAssistantService: {
      getLightPolicyState: () => ({ locked: false }),
      setAllControllableEntitiesState: (state) => {
        calls.push(state);
        return Promise.resolve();
      },
    },
  });
  const msg = message();
  await handlers.disco(msg, []);
  assert.match(msg.replies[0].content, /Disco/);

  t.mock.timers.tick(3000);
  assert.ok(calls.length >= 2, `expected several ticks, saw ${calls.length}`);
  assert.ok(calls.includes('on') && calls.includes('off'));

  // Past the end of the window the lights must be put back on and left alone.
  t.mock.timers.tick(20 * 1000);
  assert.equal(calls[calls.length - 1], 'on');
  const settled = calls.length;
  t.mock.timers.tick(20 * 1000);
  assert.equal(calls.length, settled);
});

test('vibecheck reports the battery and never issues a command', async () => {
  const { handlers, issued } = createHarness();
  const msg = message();
  await handlers.vibecheck(msg, []);

  assert.match(msg.replies[0].content, /Roomba One/);
  assert.match(msg.replies[0].content, /Battery 74%/);
  assert.equal(issued.length, 0);
});

test('vibecheck leads with the real problem when the battery is urgent', async () => {
  const { handlers, record } = createHarness();
  record.batteryState = { percentDisplay: 4, warnActive: true, urgentActive: true };
  const msg = message();
  await handlers.vibecheck(msg, []);
  assert.match(msg.replies[0].content, /dying/);
});

test('vibecheck reports an offline rover as offline', async () => {
  const { handlers, record } = createHarness();
  record.ws = null;
  const msg = message();
  await handlers.vibecheck(msg, []);
  assert.match(msg.replies[0].content, /offline/);
});

test('describeBattery falls back through the available fields', () => {
  assert.equal(describeBattery({ percentDisplay: 55.4 }), '55%');
  assert.equal(describeBattery({ percent: 0.42 }), '42%');
  assert.equal(describeBattery({}), 'unknown');
  assert.equal(describeBattery(null), 'unknown');
});
