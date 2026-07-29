// Operator Fun Text Command Tests
// Purpose: Verifies tally credit, self-targeting, cooldown refusal, mention sanitizing, and dice parsing.
// Scope: Uses an in-memory stats double so no test touches the fun stats file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFunTextCommands, parseDiceSpec, uwuify } = require('./funText');
const { createCooldownGate } = require('../cooldowns');

function createStatsDouble() {
  const store = new Map();
  return {
    calls: [],
    bumpActorStats(actorKey, { label = null, ...patch } = {}) {
      this.calls.push({ actorKey, label, patch });
      const current = store.get(actorKey) || {};
      const next = { ...current, label: label || current.label };
      Object.keys(patch).forEach((key) => {
        next[key] = (Number(current[key]) || 0) + Number(patch[key] || 0);
      });
      store.set(actorKey, next);
      return next;
    },
    getActorStats(actorKey) {
      return store.get(actorKey) || {};
    },
    listActorStats() {
      return Array.from(store.entries()).map(([actorKey, value]) => ({ actorKey, ...value }));
    },
  };
}

function createHarness({ sockets = [], activeDrivers = {} } = {}) {
  const stats = createStatsDouble();
  const events = [];
  const handlers = createFunTextCommands({
    io: { sockets: { sockets: new Map(sockets.map((entry) => [entry.id, entry])) } },
    getNickname: (entry) => entry?.data?.nickname || '',
    getActiveDrivers: () => activeDrivers,
    publishEvent: (event) => events.push(event),
    // Matches the real sanitizer so tests exercise the actual escaping rules.
    sanitizeMentions: (text) => String(text || '')
      .replace(/<(@[!&]?\d+|#\d+)>/g, '[ping removed]')
      .replace(/@everyone/gi, '[everyone]')
      .replace(/@here/gi, '[here]'),
    funStatsService: stats,
    cooldowns: createCooldownGate(),
    config: { commands: { prefix: 'rs' } },
  });
  return { handlers, stats, events };
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

const bob = { id: 's2', data: { userId: 'u-bob', nickname: 'bob' } };

test('bonk credits both sides and reports the running tally', async () => {
  const { handlers, stats } = createHarness({ sockets: [bob] });
  const msg = message();
  await handlers.bonk(msg, ['bob']);

  assert.match(msg.replies[0].content, /Bonked bob\./);
  assert.match(msg.replies[0].content, /1st bonk/);
  assert.deepEqual(
    stats.calls.map((call) => [call.actorKey, Object.keys(call.patch)[0]]),
    [['user:u-alice', 'bonksGiven'], ['user:u-bob', 'bonksTaken']],
  );
});

test('the tally ordinal advances across repeat bonks', async () => {
  const { handlers } = createHarness({ sockets: [bob] });
  await handlers.bonk(message(), ['bob']);
  // A second actor avoids the first actor's cooldown while still hitting bob.
  const second = message({ id: 's3', userId: 'u-carol', label: 'carol' });
  await handlers.bonk(second, ['bob']);
  assert.match(second.replies[0].content, /2nd bonk/);
});

test('bonking an offline name still replies but credits nobody', async () => {
  const { handlers, stats } = createHarness({ sockets: [bob] });
  const msg = message();
  await handlers.bonk(msg, ['the', 'dishwasher']);

  assert.match(msg.replies[0].content, /Bonked the dishwasher\./);
  assert.doesNotMatch(msg.replies[0].content, /bonk\b.*\dst|\dnd|\drd|\dth/);
  assert.deepEqual(stats.calls.map((call) => call.actorKey), ['user:u-alice']);
});

test('self-bonking is a special case and records nothing', async () => {
  const alice = { id: 's1', data: { userId: 'u-alice', nickname: 'alice' } };
  const { handlers, stats } = createHarness({ sockets: [alice] });
  const msg = message();
  await handlers.bonk(msg, ['alice']);

  assert.match(msg.replies[0].content, /themselves/);
  assert.equal(stats.calls.length, 0);
});

test('a repeat inside the cooldown window is refused and records nothing extra', async () => {
  const { handlers, stats } = createHarness({ sockets: [bob] });
  await handlers.bonk(message(), ['bob']);
  const countAfterFirst = stats.calls.length;

  const second = message();
  await handlers.bonk(second, ['bob']);
  assert.match(second.replies[0].content, /Slow down/);
  assert.equal(stats.calls.length, countAfterFirst);
});

test('cooldowns are per command, so a bonk does not block a hug', async () => {
  const { handlers } = createHarness({ sockets: [bob] });
  await handlers.bonk(message(), ['bob']);
  const hug = message();
  await handlers.hug(hug, ['bob']);
  assert.doesNotMatch(hug.replies[0].content, /Slow down/);
});

test('a missing target replies with usage and does not burn the cooldown', async () => {
  const { handlers } = createHarness({ sockets: [bob] });
  const first = message();
  await handlers.bonk(first, []);
  assert.match(first.replies[0].content, /Usage: `rs bonk <user>`/);

  const second = message();
  await handlers.bonk(second, ['bob']);
  assert.match(second.replies[0].content, /Bonked bob/);
});

test('every reply is sanitized so a fun command cannot ping a whole guild', async () => {
  const { handlers } = createHarness();
  const msg = message();
  await handlers.bonk(msg, ['@everyone']);
  assert.doesNotMatch(msg.replies[0].content, /@everyone/);
  assert.match(msg.replies[0].content, /\[everyone\]/);

  const roleMsg = message({ id: 's9', userId: 'u-dave', label: 'dave' });
  await handlers.slap(roleMsg, ['<@&123456>']);
  assert.match(roleMsg.replies[0].content, /\[ping removed\]/);
});

test('an actor with no identity at all is refused rather than sharing a tally', async () => {
  const { handlers, stats } = createHarness({ sockets: [bob] });
  const msg = message({ label: 'ghost' });
  await handlers.bonk(msg, ['bob']);
  assert.match(msg.replies[0].content, /Could not identify you/);
  assert.equal(stats.calls.length, 0);
});

test('ship agrees with itself regardless of argument order', async () => {
  const { handlers } = createHarness();
  const forward = message();
  await handlers.ship(forward, ['alice', 'and', 'bob']);

  const { handlers: other } = createHarness();
  const backward = message();
  await other.ship(backward, ['bob', 'and', 'alice']);

  const score = (text) => /\*\*(\d+)%\*\*/.exec(text)[1];
  assert.equal(score(forward.replies[0].content), score(backward.replies[0].content));
});

test('ship needs two sides', async () => {
  const { handlers } = createHarness();
  const msg = message();
  await handlers.ship(msg, ['alice']);
  assert.match(msg.replies[0].content, /Usage: `rs ship/);
});

test('8ball gives the same answer to the same question', async () => {
  const first = createHarness();
  const a = message();
  await first.handlers['8ball'](a, ['will', 'it', 'dock']);

  const second = createHarness();
  const b = message();
  await second.handlers['8ball'](b, ['WILL', 'IT', 'DOCK']);

  assert.equal(a.replies[0].content.split('\n')[1], b.replies[0].content.split('\n')[1]);
});

test('rate stays inside 0 to 10', async () => {
  for (const thing of ['carpet', 'the dock', 'a', 'zzzzzz', 'rover 3']) {
    const { handlers } = createHarness();
    const msg = message();
    await handlers.rate(msg, [thing]);
    const score = Number(/\*\*(\d+)\/10\*\*/.exec(msg.replies[0].content)[1]);
    assert.ok(score >= 0 && score <= 10, `${thing} scored ${score}`);
  }
});

test('dice specs parse the accepted forms and reject the rest', () => {
  assert.deepEqual(parseDiceSpec('2d6'), { count: 2, sides: 6 });
  assert.deepEqual(parseDiceSpec('d20'), { count: 1, sides: 20 });
  assert.deepEqual(parseDiceSpec(''), { count: 1, sides: 6 });
  // A bare number is read as one die of that many sides.
  assert.deepEqual(parseDiceSpec('20'), { count: 1, sides: 20 });
  assert.match(parseDiceSpec('21d6').error, /between 1 and 20 dice/);
  assert.match(parseDiceSpec('1d1').error, /2 and 1000 sides/);
  assert.match(parseDiceSpec('1d2000').error, /2 and 1000 sides/);
  assert.match(parseDiceSpec('banana').error, /NdN/);
});

test('roll totals stay within the possible range for the spec', async () => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const { handlers } = createHarness();
    const msg = message();
    await handlers.roll(msg, ['3d6']);
    const total = Number(/\*\*(\d+)\*\*/.exec(msg.replies[0].content)[1]);
    assert.ok(total >= 3 && total <= 18, `rolled ${total}`);
  }
});

test('uwu transforms text without dropping it', () => {
  assert.equal(uwuify('hello world'), 'hewwo wowwd');
  assert.equal(uwuify('love'), 'wuv');
  assert.equal(uwuify('nice'), 'nyice');
});

test('bonking someone who is driving announces the sound for their rover', async () => {
  const { handlers, events } = createHarness({ sockets: [bob], activeDrivers: { 'rover-1': 's2' } });
  await handlers.bonk(message(), ['bob']);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'fun.bonked');
  assert.equal(events[0].payload.roverId, 'rover-1');
  assert.equal(events[0].payload.targetLabel, 'bob');
});

test('bonking someone who is not driving announces nothing', async () => {
  const { handlers, events } = createHarness({ sockets: [bob], activeDrivers: {} });
  const msg = message();
  await handlers.bonk(msg, ['bob']);

  // The text bonk still lands and is still tallied; only the sound is skipped.
  assert.match(msg.replies[0].content, /Bonked bob/);
  assert.equal(events.length, 0);
});

test('bonking a name that is not a real user announces nothing', async () => {
  const { handlers, events } = createHarness({ sockets: [bob], activeDrivers: { 'rover-1': 's2' } });
  await handlers.bonk(message(), ['the dishwasher']);
  assert.equal(events.length, 0);
});

test('the bonk sound is rate limited per rover so it cannot interrupt a mic repeatedly', async () => {
  const { handlers, events } = createHarness({ sockets: [bob], activeDrivers: { 'rover-1': 's2' } });
  await handlers.bonk(message(), ['bob']);
  // A different actor has their own text cooldown but must not get a second sound.
  await handlers.bonk(message({ id: 's3', userId: 'u-carol', label: 'carol' }), ['bob']);
  await handlers.bonk(message({ id: 's4', userId: 'u-erin', label: 'erin' }), ['bob']);

  assert.equal(events.length, 1);
});

test('a self-bonk never announces a sound', async () => {
  const alice = { id: 's1', data: { userId: 'u-alice', nickname: 'alice' } };
  const { handlers, events } = createHarness({ sockets: [alice], activeDrivers: { 'rover-1': 's1' } });
  await handlers.bonk(message(), ['alice']);
  assert.equal(events.length, 0);
});

test('hug and slap do not announce a bonk sound', async () => {
  const { handlers, events } = createHarness({ sockets: [bob], activeDrivers: { 'rover-1': 's2' } });
  await handlers.hug(message(), ['bob']);
  await handlers.slap(message(), ['bob']);
  assert.equal(events.length, 0);
});

test('a transport with no publishEvent still bonks normally', async () => {
  const stats = createStatsDouble();
  const handlers = createFunTextCommands({
    io: { sockets: { sockets: new Map([[bob.id, bob]]) } },
    getNickname: (entry) => entry?.data?.nickname || '',
    getActiveDrivers: () => ({ 'rover-1': 's2' }),
    publishEvent: undefined,
    sanitizeMentions: (text) => String(text || ''),
    funStatsService: stats,
    cooldowns: createCooldownGate(),
    config: { commands: { prefix: 'rs' } },
  });
  const msg = message();
  await handlers.bonk(msg, ['bob']);
  assert.match(msg.replies[0].content, /Bonked bob/);
});

test('wanted includes prior bonks when the target has any on record', async () => {
  const { handlers } = createHarness({ sockets: [bob] });
  await handlers.bonk(message(), ['bob']);

  const msg = message({ id: 's4', userId: 'u-erin', label: 'erin' });
  await handlers.wanted(msg, ['bob']);
  assert.match(msg.replies[0].content, /WANTED/);
  assert.match(msg.replies[0].content, /Prior bonks on record: 1/);
});
