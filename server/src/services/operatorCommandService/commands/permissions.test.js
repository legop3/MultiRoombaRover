// Operator Permissions Command Tests
// Purpose: Pins admin authorization and the universal grant, revoke, and list command contract.
// Scope: Uses in-memory identity doubles; database persistence is tested by identityService.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissionsCommand } = require('./permissions');

const USER = {
  id: 'usr_11111111111111111111111111111111',
  nickname: 'alice',
  cookieUserIds: ['cu_11111111111111111111111111111111'],
  fingerprintIds: [],
  knownIps: [],
};
const PERMISSION = {
  key: 'audio.personalAdjustment',
  commandName: 'audio-adjustment',
  label: 'Personal audio adjustment',
  description: 'Allows personal volume adjustments.',
};

function harness({ isAdmin = true, granted = [] } = {}) {
  const replies = [];
  const changes = [];
  const handler = createPermissionsCommand({
    listUsersForAdmin: () => [USER],
    listUsersWithPermission: () => granted,
    listRegisteredPermissions: () => [PERMISSION],
    setUserPermission: (userId, permissionKey, options) => {
      changes.push({ userId, permissionKey, options });
      return USER;
    },
    sanitizeMentions: String,
    config: { commands: { prefix: 'rs' } },
  });
  const message = {
    actor: { id: 'admin-1', isAdmin },
    reply: async (payload) => replies.push(payload.content),
  };
  return { handler, message, replies, changes };
}

test('non-admin users cannot inspect or change grants', async () => {
  const { handler, message, replies } = harness({ isAdmin: false });
  await handler(message, ['list']);
  assert.match(replies[0], /Only admins/);
});

test('grant resolves a user and writes the registered permission key', async () => {
  const { handler, message, changes, replies } = harness();
  await handler(message, ['grant', 'audio-adjustment', 'alice']);

  assert.equal(changes[0].userId, USER.id);
  assert.equal(changes[0].permissionKey, PERMISSION.key);
  assert.equal(changes[0].options.enabled, true);
  assert.match(replies[0], /Granted Personal audio adjustment/);
});

test('list shows users holding a permission', async () => {
  const { handler, message, replies } = harness({ granted: [USER] });
  await handler(message, ['list', 'audio-adjustment']);
  assert.match(replies[0], /alice/);
  assert.match(replies[0], new RegExp(USER.id));
});
