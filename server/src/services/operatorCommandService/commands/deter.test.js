// Operator Deter Command Tests
// Purpose: Verifies that live nickname identity takes precedence over ambiguous stored aliases.
// Scope: Exercises only command target resolution with in-memory socket and identity doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeterCommand } = require('./deter');

function createSocket(id, userId, nickname) {
  return { id, data: { userId, nickname } };
}

function createHarness(sockets = [], verifiedUsers = []) {
  const deterCalls = [];
  const muteCalls = [];
  const replies = [];
  const handler = createDeterCommand({
    io: { sockets: { sockets: new Map(sockets.map((socket) => [socket.id, socket])) } },
    getNickname: (socket) => socket?.data?.nickname || '',
    listDeterredUsers: () => [],
    listMutedUsers: () => [],
    listVerifiedUsers: () => verifiedUsers,
    deterUser: (selector) => {
      deterCalls.push(selector);
      return { created: true, nickname: 'Croissant', cookieUserId: 'cookie-croissant' };
    },
    undeterUser: () => null,
    muteUser: (selector) => {
      muteCalls.push({ action: 'mute', selector });
      return { nickname: 'Croissant', cookieUserId: 'cookie-croissant' };
    },
    unmuteUser: (selector) => {
      muteCalls.push({ action: 'unmute', selector });
      return { nickname: 'Croissant', cookieUserId: 'cookie-croissant' };
    },
    sanitizeMentions: (value) => value,
    config: { commands: { prefix: 'rs' } },
  });
  const message = {
    actor: { id: 'admin', isLockdownAdmin: true },
    reply: async (payload) => {
      replies.push(payload);
      return payload;
    },
  };
  return { handler, message, deterCalls, muteCalls, replies };
}

test('prefers the one online exact nickname over ambiguous stored records', async () => {
  const verifiedUsers = [
    { userId: 'old-user', nickname: 'Croissant', cookieUserId: 'old-cookie' },
    { userId: 'live-user', nickname: 'Croissant', cookieUserId: 'live-cookie' },
  ];
  const { handler, message, deterCalls } = createHarness([
    createSocket('socket-1', 'live-user', 'Croissant'),
  ], verifiedUsers);

  await handler(message, ['ban', 'croissant']);

  assert.deepEqual(deterCalls, ['live-user']);
});

test('collapses multiple sockets belonging to the same online identity', async () => {
  const { handler, message, deterCalls } = createHarness([
    createSocket('socket-1', 'live-user', 'Croissant'),
    createSocket('socket-2', 'live-user', 'croissant'),
  ]);

  await handler(message, ['ban', 'Croissant']);

  assert.deepEqual(deterCalls, ['live-user']);
});

test('returns usable user ids when different online identities share a nickname', async () => {
  const { handler, message, deterCalls, replies } = createHarness([
    createSocket('socket-1', 'user-one', 'Croissant'),
    createSocket('socket-2', 'user-two', 'croissant'),
  ]);

  await handler(message, ['ban', 'croissant']);

  assert.deepEqual(deterCalls, []);
  assert.match(replies[0].content, /user-one/);
  assert.match(replies[0].content, /user-two/);
  assert.match(replies[0].content, /rs deter ban <userId>/);
});

test('mute uses the same exact online nickname preference as ban', async () => {
  const verifiedUsers = [
    { userId: 'old-user', nickname: 'Croissant', cookieUserId: 'old-cookie' },
    { userId: 'live-user', nickname: 'Croissant', cookieUserId: 'live-cookie' },
  ];
  const { handler, message, muteCalls } = createHarness([
    createSocket('socket-1', 'live-user', 'Croissant'),
  ], verifiedUsers);

  await handler(message, ['mute', 'croissant']);

  assert.deepEqual(muteCalls, [{ action: 'mute', selector: 'live-user' }]);
});

test('unmute returns usable ids for genuinely duplicated online nicknames', async () => {
  const { handler, message, muteCalls, replies } = createHarness([
    createSocket('socket-1', 'user-one', 'Croissant'),
    createSocket('socket-2', 'user-two', 'croissant'),
  ]);

  await handler(message, ['unmute', 'Croissant']);

  assert.deepEqual(muteCalls, []);
  assert.match(replies[0].content, /user-one/);
  assert.match(replies[0].content, /user-two/);
  assert.match(replies[0].content, /rs deter unmute <userId>/);
});
