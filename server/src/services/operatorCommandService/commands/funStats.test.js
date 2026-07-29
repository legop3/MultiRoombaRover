// Operator Fun Stats Command Tests
// Purpose: Verifies the leaderboard ordering, rover pet counting, and what snitch reports.
// Scope: In-memory stats and roster doubles only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFunStatsCommands, formatLeaderboard } = require('./funStats');
const { createCooldownGate } = require('../cooldowns');

const ALICE = { id: 's1', data: { userId: 'u-alice', nickname: 'alice' } };
const BOB = { id: 's2', data: { userId: 'u-bob', nickname: 'bob' } };

function createHarness({
  actorRows = [],
  activeDrivers = {},
  socket = ALICE,
  rovers = new Map([
    ['rover-1', { id: 'rover-1', meta: { name: 'Roomba One' } }],
    ['rover-2', { id: 'rover-2', meta: { name: 'Roomba Two' } }],
  ]),
} = {}) {
  const pets = new Map();
  const handlers = createFunStatsCommands({
    io: { sockets: { sockets: new Map([[ALICE.id, ALICE], [BOB.id, BOB]]) } },
    rovers,
    getNickname: (entry) => entry?.data?.nickname || '',
    getActiveDrivers: () => activeDrivers,
    getActorSocket: () => socket,
    roverManager: { getPrimaryRoverForSocket: () => 'rover-1' },
    sanitizeMentions: (text) => String(text || '').replace(/@everyone/gi, '[everyone]'),
    funStatsService: {
      listActorStats: () => actorRows,
      bumpRoverPets: (roverId, by) => {
        const next = (pets.get(roverId) || 0) + by;
        pets.set(roverId, next);
        return next;
      },
    },
    cooldowns: createCooldownGate(),
    config: { commands: { prefix: 'rs' } },
  });
  return { handlers, pets };
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

test('the leaderboard sorts descending and drops zero scores', () => {
  const rows = [
    { label: 'alice', bonksGiven: 2 },
    { label: 'bob', bonksGiven: 9 },
    { label: 'carol', bonksGiven: 0 },
  ];
  const rendered = formatLeaderboard('Most bonks dealt', rows, 'bonksGiven');
  const lines = rendered.split('\n');
  assert.equal(lines[1], '1. bob — 9');
  assert.equal(lines[2], '2. alice — 2');
  assert.equal(lines.length, 3, 'carol should not appear with a zero score');
});

test('the leaderboard is capped at ten entries', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ label: `user${index}`, bonksGiven: index + 1 }));
  const rendered = formatLeaderboard('Most bonks dealt', rows, 'bonksGiven');
  assert.equal(rendered.split('\n').length - 1, 10);
});

test('an all-zero counter renders no section at all', () => {
  assert.equal(formatLeaderboard('Most bonks dealt', [{ label: 'alice', bonksGiven: 0 }], 'bonksGiven'), null);
});

test('bonkboard says so when nothing has happened yet', async () => {
  const { handlers } = createHarness({ actorRows: [] });
  const msg = message();
  await handlers.bonkboard(msg, []);
  assert.match(msg.replies[0].content, /Nobody has been bonked yet/);
});

test('bonkboard renders each populated section', async () => {
  const { handlers } = createHarness({
    actorRows: [
      { label: 'alice', bonksGiven: 3, bonksTaken: 0, hugsGiven: 1 },
      { label: 'bob', bonksGiven: 0, bonksTaken: 3, hugsGiven: 0 },
    ],
  });
  const msg = message();
  await handlers.bonkboard(msg, []);

  assert.match(msg.replies[0].content, /Most bonks dealt/);
  assert.match(msg.replies[0].content, /Most bonks taken/);
  assert.match(msg.replies[0].content, /Most hugs given/);
});

test('bonkboard sanitizes stored labels, so a hostile nickname cannot ping a guild', async () => {
  const { handlers } = createHarness({ actorRows: [{ label: '@everyone', bonksGiven: 1 }] });
  const msg = message();
  await handlers.bonkboard(msg, []);
  assert.doesNotMatch(msg.replies[0].content, /@everyone/);
});

test('pet counts against the rover the caller is on when none is named', async () => {
  const { handlers, pets } = createHarness();
  const msg = message();
  await handlers.pet(msg, []);

  assert.match(msg.replies[0].content, /pets Roomba One/);
  assert.match(msg.replies[0].content, /petted 1 time\./);
  assert.equal(pets.get('rover-1'), 1);
});

test('pet accepts an explicit rover and keeps a separate count per rover', async () => {
  const { handlers, pets } = createHarness();
  await handlers.pet(message(), ['Roomba Two']);
  await handlers.pet(message({ id: 's2', userId: 'u-bob', label: 'bob' }), ['Roomba Two']);

  assert.equal(pets.get('rover-2'), 2);
  assert.equal(pets.get('rover-1'), undefined);
});

test('pet pluralizes the running total', async () => {
  const { handlers } = createHarness();
  await handlers.pet(message(), []);
  const second = message({ id: 's2', userId: 'u-bob', label: 'bob' });
  await handlers.pet(second, []);
  assert.match(second.replies[0].content, /petted 2 times\./);
});

test('pet from a transport with no socket asks for a rover name', async () => {
  const { handlers, pets } = createHarness({ socket: null });
  const msg = message({ id: '4242', label: 'DiscordUser' });
  await handlers.pet(msg, []);

  assert.match(msg.replies[0].content, /Name a rover/);
  assert.equal(pets.size, 0);
});

test('snitch names the active driver and reports idle rovers as nobody', async () => {
  const { handlers } = createHarness({ activeDrivers: { 'rover-1': 's2' } });
  const msg = message();
  await handlers.snitch(msg, []);

  assert.match(msg.replies[0].content, /Roomba One — bob/);
  assert.match(msg.replies[0].content, /Roomba Two — nobody/);
});

test('snitch handles a driver socket that has already gone away', async () => {
  const { handlers } = createHarness({ activeDrivers: { 'rover-1': 'ghost-socket' } });
  const msg = message();
  await handlers.snitch(msg, []);
  assert.match(msg.replies[0].content, /Roomba One — someone who will not say their name/);
});

test('snitch reports an empty fleet rather than an empty message', async () => {
  const { handlers } = createHarness({ rovers: new Map() });
  const msg = message();
  await handlers.snitch(msg, []);
  assert.match(msg.replies[0].content, /No rovers are online/);
});
