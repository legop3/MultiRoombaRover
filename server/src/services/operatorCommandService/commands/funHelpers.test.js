// Operator Fun Helper Tests
// Purpose: Locks down actor identity, target resolution, and the deterministic seeding the fun commands depend on.
// Scope: Pure helpers plus in-memory socket doubles; nothing here touches the fun stats store.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildActorKey,
  clampEcho,
  createRoverResolver,
  hashSeed,
  ordinal,
  pairSeed,
  percentFromSeed,
  pickBySeed,
  resolveFunTarget,
  MAX_ECHO_LENGTH,
} = require('./funHelpers');

function socket(id, userId, nickname) {
  return { id, data: { userId, nickname } };
}

function harness(sockets = []) {
  return {
    io: { sockets: { sockets: new Map(sockets.map((entry) => [entry.id, entry])) } },
    getNickname: (entry) => entry?.data?.nickname || '',
  };
}

test('site chat keys on the identity user id, not the socket', () => {
  assert.equal(
    buildActorKey({ transport: 'web-chat', actor: { id: 'socket-1', userId: 'u-alice' } }),
    'user:u-alice',
  );
});

test('an unidentified site socket falls back to its socket id', () => {
  assert.equal(
    buildActorKey({ transport: 'web-chat', actor: { id: 'socket-1' } }),
    'socket:socket-1',
  );
});

test('discord actors get their own key space so ids cannot collide with identity ids', () => {
  assert.equal(buildActorKey({ transport: 'discord', actor: { id: '4242' } }), 'discord:4242');
});

test('an actor with no usable id at all is rejected rather than sharing a bucket', () => {
  assert.equal(buildActorKey({ transport: 'web-chat', actor: {} }), null);
  assert.equal(buildActorKey({ transport: 'discord', actor: {} }), null);
});

test('a single online nickname resolves to that user and credits their tally', () => {
  const { io, getNickname } = harness([socket('s1', 'u-bob', 'bob')]);
  const resolved = resolveFunTarget({ io, getNickname, selector: 'BOB' });
  assert.equal(resolved.label, 'bob');
  assert.equal(resolved.actorKey, 'user:u-bob');
  assert.equal(resolved.online, true);
});

test('multiple tabs for one person do not make the target ambiguous', () => {
  const { io, getNickname } = harness([
    socket('s1', 'u-bob', 'bob'),
    socket('s2', 'u-bob', 'bob'),
  ]);
  const resolved = resolveFunTarget({ io, getNickname, selector: 'bob' });
  assert.equal(resolved.actorKey, 'user:u-bob');
});

test('an unmatched selector still works but credits nobody', () => {
  const { io, getNickname } = harness([socket('s1', 'u-bob', 'bob')]);
  const resolved = resolveFunTarget({ io, getNickname, selector: 'the dishwasher' });
  assert.equal(resolved.label, 'the dishwasher');
  assert.equal(resolved.actorKey, null);
  assert.equal(resolved.online, false);
});

test('two different people sharing a nickname credit neither', () => {
  const { io, getNickname } = harness([
    socket('s1', 'u-bob', 'bob'),
    socket('s2', 'u-other', 'bob'),
  ]);
  const resolved = resolveFunTarget({ io, getNickname, selector: 'bob' });
  assert.equal(resolved.actorKey, null);
});

test('echoed text is length capped so a fun command cannot shout a wall of text', () => {
  const long = 'a'.repeat(500);
  const clamped = clampEcho(long);
  assert.equal(clamped.length, MAX_ECHO_LENGTH);
  assert.ok(clamped.endsWith('…'));
});

test('ship is order independent so both spellings agree', () => {
  assert.equal(pairSeed('alice', 'bob'), pairSeed('bob', 'alice'));
});

test('seeded verdicts are stable, so a rating cannot be rerolled by asking again', () => {
  const first = percentFromSeed(pairSeed('alice', 'bob'));
  const second = percentFromSeed(pairSeed('alice', 'bob'));
  assert.equal(first, second);
  assert.ok(first >= 0 && first <= 100);
});

test('hashSeed ignores case and surrounding whitespace', () => {
  assert.equal(hashSeed('  Will It Dock '), hashSeed('will it dock'));
});

test('pickBySeed stays in range and tolerates an empty list', () => {
  const list = ['a', 'b', 'c'];
  for (let seed = 0; seed < 20; seed += 1) {
    assert.ok(list.includes(pickBySeed(list, seed)));
  }
  assert.equal(pickBySeed([], 5), null);
});

test('ordinal handles the teens correctly', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(111), '111th');
});

test('an explicit rover name wins over whatever the caller is attached to', () => {
  const rovers = new Map([
    ['rover-1', { id: 'rover-1', meta: { name: 'Roomba One' } }],
    ['rover-2', { id: 'rover-2', meta: { name: 'Roomba Two' } }],
  ]);
  const resolve = createRoverResolver({
    rovers,
    roverManager: { getPrimaryRoverForSocket: () => 'rover-1' },
    getActorSocket: () => ({ id: 's1' }),
  });
  assert.equal(resolve('Roomba Two').id, 'rover-2');
});

test('with no rover named the caller\'s current rover is used', () => {
  const rovers = new Map([['rover-1', { id: 'rover-1', meta: { name: 'Roomba One' } }]]);
  const resolve = createRoverResolver({
    rovers,
    roverManager: { getPrimaryRoverForSocket: (socketId) => (socketId === 's1' ? 'rover-1' : null) },
    getActorSocket: () => ({ id: 's1' }),
  });
  const resolved = resolve('');
  assert.equal(resolved.id, 'rover-1');
  assert.equal(resolved.name, 'Roomba One');
});

test('without a socket the caller is asked to name a rover instead of one being chosen', () => {
  const resolve = createRoverResolver({
    rovers: new Map(),
    roverManager: {},
    getActorSocket: () => null,
    commandPrefix: 'rs',
  });
  assert.match(resolve('', 'pet').error, /Name a rover/);
});
