// Identity Permission Storage Tests
// Purpose: Verifies normalized grants, registry validation, and the intentionally empty replacement for legacy audio boost flags.
// Scope: Uses an isolated temporary data directory and never opens the development identity database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-identity-permissions-'));
process.env.SERVER_DATA_DIR = testDataDir;
/*
  Seed the exact legacy concern this redesign removes. Opening identityService
  must preserve the real moderation fields while dropping all old boost grants
  instead of translating them into the new permission table.
*/
const legacyDb = new Database(path.join(testDataDir, 'identity.sqlite'));
legacyDb.exec(`
  create table users (
    id text primary key,
    created_at integer not null,
    updated_at integer not null,
    last_seen_at integer
  );
  create table user_status (
    user_id text primary key references users(id) on delete cascade,
    verified_enabled integer not null default 0,
    verified_at integer,
    verified_by text,
    deterrence_enabled integer not null default 0,
    deterrence_reason text,
    deterrence_at integer,
    deterrence_by text,
    muted_enabled integer not null default 0,
    muted_at integer,
    muted_by text,
    audio_gain_boost_enabled integer not null default 0,
    audio_gain_boost_at integer,
    audio_gain_boost_by text
  );
`);
legacyDb.close();
const identityService = require('./index');

test.after(() => {
  identityService.getDb().close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('legacy audio boost columns are removed and normalized permissions are created empty', () => {
  const db = identityService.getDb();
  const statusColumns = db.prepare('pragma table_info(user_status)').all().map((column) => column.name);

  assert.doesNotMatch(statusColumns.join(','), /audio_gain_boost/);
  assert.ok(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'user_permissions'").get());
});

test('registered permissions can be granted, listed, queried, and revoked', () => {
  const userId = identityService.resolveUserIdForIdentity({ cookieUserId: 'cu_11111111111111111111111111111111' });

  assert.equal(identityService.hasUserPermission(userId, 'audio.personalAdjustment'), false);
  identityService.setUserPermission(userId, 'audio-adjustment', { enabled: true, actor: 'test-admin', at: 1234 });
  assert.equal(identityService.hasUserPermission(userId, 'audio.personalAdjustment'), true);
  assert.deepEqual(identityService.getUserPermissions(userId), [{
    key: 'audio.personalAdjustment',
    grantedAt: 1234,
    grantedBy: 'test-admin',
  }]);
  assert.equal(identityService.listUsersWithPermission('audio-adjustment')[0].id, userId);

  identityService.setUserPermission(userId, 'audio.personalAdjustment', { enabled: false });
  assert.equal(identityService.hasUserPermission(userId, 'audio.personalAdjustment'), false);
});

test('unknown permission keys cannot be persisted', () => {
  const userId = identityService.resolveUserIdForIdentity({ cookieUserId: 'cu_22222222222222222222222222222222' });
  assert.throws(
    () => identityService.setUserPermission(userId, 'made.up.permission', { enabled: true }),
    /Unknown user permission/,
  );
});
