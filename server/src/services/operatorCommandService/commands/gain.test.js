// Operator Gain Command Tests
// Purpose: Verifies the audio gain boost command stays admin-only and VIP-only.
// Scope: Exercises command target resolution with in-memory identity doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGainCommand } = require('./gain');

const VIPS = [
  { userId: 'usr-vip', nickname: 'Croissant', cookieUserId: 'cookie-croissant' },
  { userId: 'usr-other', nickname: 'Baguette', cookieUserId: 'cookie-baguette' },
];

// Two verified records sharing one nickname. This is the real shape behind the
// "matched multiple records" failure: one person re-verifying from a new browser
// produces a second record with the same name and a different cookie id.
const DUPLICATE_SAULS = [
  { userId: 'usr-saul-a', nickname: 'Saul', cookieUserId: 'cu_a28ffffffff33ab5c' },
  { userId: 'usr-saul-b', nickname: 'Saul', cookieUserId: 'cu_5a5ffffffffb6add3' },
];

function createSocketRegistry(onlineUserIds = []) {
  const sockets = new Map();
  onlineUserIds.forEach((userId, index) => {
    // Two sockets per identity, so the resolver must dedupe rather than count
    // connections.
    sockets.set(`s${index}a`, { id: `s${index}a`, data: { userId } });
    sockets.set(`s${index}b`, { id: `s${index}b`, data: { userId } });
  });
  return { sockets: { sockets } };
}

function createHarness({ verified = VIPS, boosted = [], isAdmin = true, online = [] } = {}) {
  const calls = [];
  const replies = [];
  const handler = createGainCommand({
    io: createSocketRegistry(online),
    listVerifiedUsers: () => verified,
    listAudioGainBoostUsers: () => boosted,
    grantAudioGainBoost: (selector, actor) => {
      calls.push({ action: 'grant', selector, actor });
      return { nickname: 'Croissant', cookieUserId: 'cookie-croissant' };
    },
    revokeAudioGainBoost: (selector, actor) => {
      calls.push({ action: 'revoke', selector, actor });
      return { nickname: 'Croissant', cookieUserId: 'cookie-croissant' };
    },
    sanitizeMentions: (value) => value,
    config: { commands: { prefix: 'rs' } },
  });
  const message = {
    actor: { id: 'admin', isAdmin },
    reply: async (payload) => {
      replies.push(payload);
      return payload;
    },
  };
  return { handler, message, calls, replies };
}

test('non-admins cannot manage the boost', async () => {
  const { handler, message, calls, replies } = createHarness({ isAdmin: false });

  await handler(message, ['grant', 'Croissant']);

  assert.deepEqual(calls, []);
  assert.match(replies[0].content, /Only admins/);
});

test('grant resolves a VIP nickname to its stable user id', async () => {
  const { handler, message, calls } = createHarness();

  await handler(message, ['grant', 'croissant']);

  assert.deepEqual(calls, [{ action: 'grant', selector: 'usr-vip', actor: 'admin' }]);
});

test('grant refuses a nickname that belongs to no VIP', async () => {
  const { handler, message, calls, replies } = createHarness({ verified: [] });

  await handler(message, ['grant', 'Stranger']);

  assert.deepEqual(calls, []);
  assert.match(replies[0].content, /not found/i);
});

test('revoke only matches users who currently hold the boost', async () => {
  const { handler, message, calls, replies } = createHarness({ boosted: [] });

  await handler(message, ['revoke', 'Croissant']);

  assert.deepEqual(calls, []);
  assert.match(replies[0].content, /not found/i);
});

test('revoke resolves against the boosted list', async () => {
  const { handler, message, calls } = createHarness({ boosted: [VIPS[0]] });

  await handler(message, ['revoke', 'Croissant']);

  assert.deepEqual(calls, [{ action: 'revoke', selector: 'usr-vip', actor: 'admin' }]);
});

test('grant without a target prints usage instead of acting', async () => {
  const { handler, message, calls, replies } = createHarness();

  await handler(message, ['grant']);

  assert.deepEqual(calls, []);
  assert.match(replies[0].content, /rs gain grant/);
});

test('list defaults when no subcommand is given', async () => {
  const { handler, message, replies } = createHarness({ boosted: [VIPS[0]] });

  await handler(message, []);

  assert.match(replies[0].content, /Croissant/);
  assert.match(replies[0].content, /usr-vip/);
});

test('list reports an empty holder set', async () => {
  const { handler, message, replies } = createHarness({ boosted: [] });

  await handler(message, ['list']);

  assert.match(replies[0].content, /No users hold/);
});

test('duplicate nicknames resolve to the account that is online', async () => {
  const { handler, message, calls, replies } = createHarness({
    verified: DUPLICATE_SAULS,
    online: ['usr-saul-b'],
  });

  await handler(message, ['grant', 'Saul']);

  assert.deepEqual(calls, [{ action: 'grant', selector: 'usr-saul-b', actor: 'admin' }]);
  assert.doesNotMatch(replies[0].content, /matched multiple records/i);
  assert.match(replies[0].content, /2 accounts share that name; picked the one that is online/);
});

test('duplicate nicknames fall back to the first record when nobody is online', async () => {
  const { handler, message, calls, replies } = createHarness({
    verified: DUPLICATE_SAULS,
    online: [],
  });

  await handler(message, ['grant', 'Saul']);

  assert.deepEqual(calls, [{ action: 'grant', selector: 'usr-saul-a', actor: 'admin' }]);
  assert.match(replies[0].content, /none are online; picked the first/);
});

test('an unrelated online user does not influence the pick', async () => {
  const { handler, message, calls } = createHarness({
    verified: DUPLICATE_SAULS,
    online: ['usr-somebody-else'],
  });

  await handler(message, ['grant', 'Saul']);

  assert.deepEqual(calls, [{ action: 'grant', selector: 'usr-saul-a', actor: 'admin' }]);
});

test('several duplicates online pick one deterministically rather than refusing', async () => {
  const { handler, message, calls, replies } = createHarness({
    verified: DUPLICATE_SAULS,
    online: ['usr-saul-a', 'usr-saul-b'],
  });

  await handler(message, ['grant', 'Saul']);

  assert.deepEqual(calls, [{ action: 'grant', selector: 'usr-saul-a', actor: 'admin' }]);
  assert.match(replies[0].content, /picked the one that is online/);
});

test('revoke disambiguates the same way against the boosted list', async () => {
  const { handler, message, calls } = createHarness({
    boosted: DUPLICATE_SAULS,
    online: ['usr-saul-b'],
  });

  await handler(message, ['revoke', 'Saul']);

  assert.deepEqual(calls, [{ action: 'revoke', selector: 'usr-saul-b', actor: 'admin' }]);
});

test('a unique nickname reports no disambiguation note', async () => {
  const { handler, message, replies } = createHarness();

  await handler(message, ['grant', 'Croissant']);

  assert.doesNotMatch(replies[0].content, /accounts share that name/);
});

test('an exact cookieUserId still selects one record out of a duplicate pair', async () => {
  const { handler, message, calls } = createHarness({ verified: DUPLICATE_SAULS });

  await handler(message, ['grant', 'cu_5a5ffffffffb6add3']);

  assert.deepEqual(calls, [{ action: 'grant', selector: 'usr-saul-b', actor: 'admin' }]);
});

test('a typo still resolves through the fuzzy matcher', async () => {
  const { handler, message, calls } = createHarness();

  await handler(message, ['grant', 'Croissnat']);

  assert.deepEqual(calls, [{ action: 'grant', selector: 'usr-vip', actor: 'admin' }]);
});

test('help lists every subcommand', async () => {
  const { handler, message, calls, replies } = createHarness();

  await handler(message, ['help']);

  assert.deepEqual(calls, [], 'help must not change anything');
  for (const fragment of ['rs gain list', 'rs gain grant <vip>', 'rs gain revoke <vip>', 'rs gain help']) {
    assert.ok(replies[0].content.includes(fragment), `help should mention ${fragment}`);
  }
  // Subcommand help follows the same copy-friendly punctuation rule as the
  // shared `rs help` renderer instead of quietly reintroducing em dashes.
  assert.doesNotMatch(replies[0].content, /—/);
});

test('an unknown subcommand falls back to the same help text', async () => {
  const { handler, message, calls, replies } = createHarness();

  await handler(message, ['sideways']);

  assert.deepEqual(calls, []);
  assert.match(replies[0].content, /Unknown gain command/);
  assert.ok(replies[0].content.includes('rs gain grant <vip>'));
});

test('help stays admin-only like the rest of the command', async () => {
  const { handler, message, replies } = createHarness({ isAdmin: false });

  await handler(message, ['help']);

  assert.match(replies[0].content, /Only admins/);
});

test('a service rejection is surfaced instead of thrown', async () => {
  const { handler, message, replies } = createHarness();
  const failing = createGainCommand({
    io: createSocketRegistry([]),
    listVerifiedUsers: () => VIPS,
    listAudioGainBoostUsers: () => [],
    grantAudioGainBoost: () => {
      throw new Error('Only verified VIPs can be granted an audio gain boost.');
    },
    revokeAudioGainBoost: () => null,
    sanitizeMentions: (value) => value,
    config: { commands: { prefix: 'rs' } },
  });

  await failing(message, ['grant', 'Croissant']);

  assert.match(replies[0].content, /Only verified VIPs/);
});
