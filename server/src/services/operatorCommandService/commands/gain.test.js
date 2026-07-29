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

function createHarness({ verified = VIPS, boosted = [], isAdmin = true } = {}) {
  const calls = [];
  const replies = [];
  const handler = createGainCommand({
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

test('a service rejection is surfaced instead of thrown', async () => {
  const { handler, message, replies } = createHarness();
  const failing = createGainCommand({
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
