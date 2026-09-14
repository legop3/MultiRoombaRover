// Configuration Database
// Purpose: Persists complete immutable configuration revisions, administrator accounts, and administrative audit history.
// Scope: Owns SQLite transactions and invariants; transport authorization and password hashing remain service concerns.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { resolveDataPath } = require('../helpers/dataPaths');
const { applySchemaMigrations } = require('./migrations');
const {
  defaultConfig,
  secretPaths,
  clone,
  normalizeConfig,
  assertValidConfig,
} = require('./validation');

const DEFAULT_DATABASE_PATH = resolveDataPath('configuration.sqlite');

function normalizeUsername(value) {
  const username = String(value || '').trim();
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) {
    throw new Error('Administrator username must be 1-64 letters, numbers, dots, underscores, or hyphens.');
  }
  return username;
}

function normalizeRole(value) {
  if (value === 'admin' || value === 'lockdown') return value;
  throw new Error('Administrator role must be admin or lockdown.');
}

function splitPath(value) {
  return String(value || '').split('.').filter(Boolean);
}

function getAtPath(object, dottedPath) {
  return splitPath(dottedPath).reduce((value, key) => value?.[key], object);
}

function setAtPath(object, dottedPath, value) {
  const parts = splitPath(dottedPath);
  let cursor = object;
  parts.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[parts.at(-1)] = value;
}

function redactConfiguration(config) {
  const redacted = clone(config);
  const configuredSecrets = {};
  secretPaths.forEach((secretPath) => {
    configuredSecrets[secretPath] = Boolean(getAtPath(config, secretPath));
    setAtPath(redacted, secretPath, '');
  });
  return { config: redacted, configuredSecrets };
}

function createConfigurationDatabase({ databasePath = DEFAULT_DATABASE_PATH } = {}) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applySchemaMigrations(db);

  const readActiveStatement = db.prepare(`
    SELECT r.id, r.config_json, r.created_at, r.actor, r.source
    FROM configuration_state s
    JOIN configuration_revisions r ON r.id = s.active_revision_id
    WHERE s.singleton = 1
  `);
  const insertRevisionStatement = db.prepare(`
    INSERT INTO configuration_revisions (config_json, created_at, actor, source)
    VALUES (?, ?, ?, ?)
  `);
  const activateRevisionStatement = db.prepare(`
    INSERT INTO configuration_state (singleton, active_revision_id)
    VALUES (1, ?)
    ON CONFLICT(singleton) DO UPDATE SET active_revision_id = excluded.active_revision_id
  `);
  const insertAuditStatement = db.prepare(`
    INSERT INTO administrative_audit_events (created_at, actor, action, details_json)
    VALUES (?, ?, ?, ?)
  `);

  function writeAudit(actor, action, details = {}) {
    /*
      Callers pass deliberately small, already-redacted metadata. Configuration
      values and password hashes never belong in audit details because audit
      history is routinely displayed and retained longer than request bodies.
    */
    insertAuditStatement.run(Date.now(), String(actor || 'system'), String(action), JSON.stringify(details));
  }

  const commitRevisionTransaction = db.transaction((config, metadata) => {
    const current = readActiveStatement.get();
    if (metadata.expectedRevision != null && Number(metadata.expectedRevision) !== Number(current?.id)) {
      const error = new Error('Configuration changed in another session. Reload before saving.');
      error.code = 'CONFIG_REVISION_CONFLICT';
      error.currentRevision = current?.id || null;
      throw error;
    }
    assertValidConfig(config);
    const createdAt = Date.now();
    const inserted = insertRevisionStatement.run(
      JSON.stringify(config),
      createdAt,
      String(metadata.actor || 'system'),
      String(metadata.source || 'admin'),
    );
    activateRevisionStatement.run(inserted.lastInsertRowid);
    writeAudit(metadata.actor, 'configuration.saved', {
      revision: Number(inserted.lastInsertRowid),
      source: String(metadata.source || 'admin'),
    });
    return Number(inserted.lastInsertRowid);
  });

  const initialActiveRow = readActiveStatement.get();
  if (!initialActiveRow) {
    commitRevisionTransaction(clone(defaultConfig), {
      actor: 'system',
      source: 'first-boot-defaults',
    });
  } else {
    /*
      New service-owned fields receive their declared defaults as a new revision on
      startup. Unknown or newly invalid fields still fail validation; this is a
      forward schema evolution path, not a compatibility layer that discards
      data it no longer understands.
    */
    const storedConfig = JSON.parse(initialActiveRow.config_json);
    const normalizedConfig = normalizeConfig(storedConfig);
    assertValidConfig(normalizedConfig);
    if (JSON.stringify(normalizedConfig) !== JSON.stringify(storedConfig)) {
      commitRevisionTransaction(normalizedConfig, {
        expectedRevision: Number(initialActiveRow.id),
        actor: 'system',
        source: 'registered-defaults',
      });
    }
  }

  function getActiveConfigurationRecord() {
    const row = readActiveStatement.get();
    if (!row) throw new Error('Active configuration revision is missing.');
    return {
      revision: Number(row.id),
      config: JSON.parse(row.config_json),
      createdAt: Number(row.created_at),
      actor: row.actor,
      source: row.source,
    };
  }

  function getClientConfiguration() {
    const record = getActiveConfigurationRecord();
    const redacted = redactConfiguration(record.config);
    return { ...record, ...redacted };
  }

  function updateConfiguration({
    value,
    expectedRevision,
    secretOperations = {},
    actor,
    source = 'admin-ui',
  }) {
    const active = getActiveConfigurationRecord();
    const candidate = clone(value);

    /*
      The browser edits one complete document, but its copy contains blank
      placeholders in place of every stored secret. Restore all current secret
      values first, then apply only explicit replace or clear operations. This
      keeps the full-document save model simple without ever sending an
      existing credential back to the browser.
    */
    secretPaths.forEach((secretPath) => {
      setAtPath(candidate, secretPath, getAtPath(active.config, secretPath));
      const operation = secretOperations[secretPath];
      if (!operation) return;
      if (operation.action === 'clear') setAtPath(candidate, secretPath, '');
      else if (operation.action === 'replace' && typeof operation.value === 'string' && operation.value.length > 0) {
        setAtPath(candidate, secretPath, operation.value);
      } else {
        throw new Error(`Invalid secret operation for ${secretPath}.`);
      }
    });

    return commitRevisionTransaction(candidate, {
      expectedRevision,
      actor,
      /*
        Administrative imports use this same safe update path but identify the
        selected filename in revision and audit history. The source remains
        server-controlled metadata and never contains configuration values.
      */
      source,
    });
  }

  function listConfigurationRevisions({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return db.prepare(`
      SELECT id, created_at, actor, source
      FROM configuration_revisions
      ORDER BY id DESC
      LIMIT ?
    `).all(safeLimit).map((row) => ({
      revision: Number(row.id),
      createdAt: Number(row.created_at),
      actor: row.actor,
      source: row.source,
    }));
  }

  function restoreConfigurationRevision({ revision, expectedRevision, actor }) {
    const row = db.prepare('SELECT config_json FROM configuration_revisions WHERE id = ?').get(Number(revision));
    if (!row) throw new Error('Configuration revision not found.');
    const restoredConfig = JSON.parse(row.config_json);
    return commitRevisionTransaction(restoredConfig, {
      expectedRevision,
      actor,
      source: `rollback-from-${Number(revision)}`,
    });
  }

  function listAdministrators() {
    return db.prepare(`
      SELECT id, username, discord_id, role, created_at, updated_at
      FROM administrators
      ORDER BY username COLLATE NOCASE
    `).all().map((row) => ({
      id: Number(row.id),
      username: row.username,
      discordId: row.discord_id || '',
      role: row.role,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  function findAdministratorForAuthentication(username) {
    const normalized = String(username || '').trim();
    if (!normalized) return null;
    const row = db.prepare(`
      SELECT id, username, password_hash, discord_id, role
      FROM administrators
      WHERE username = ? COLLATE NOCASE
    `).get(normalized);
    if (!row) return null;
    return {
      id: Number(row.id),
      username: row.username,
      passwordHash: row.password_hash,
      discordId: row.discord_id || '',
      role: row.role,
    };
  }

  function countLockdownAdministrators() {
    return Number(db.prepare("SELECT COUNT(*) AS count FROM administrators WHERE role = 'lockdown'").get().count);
  }

  const createAdministratorTransaction = db.transaction((admin, actor, audit = true) => {
    const username = normalizeUsername(admin.username);
    const role = normalizeRole(admin.role);
    const passwordHash = String(admin.passwordHash || '').trim();
    if (!passwordHash) throw new Error('Administrator password hash is required.');
    const now = Date.now();
    const result = db.prepare(`
      INSERT INTO administrators (username, password_hash, discord_id, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, passwordHash, String(admin.discordId || '').trim() || null, role, now, now);
    if (audit) writeAudit(actor, 'administrator.created', { administratorId: Number(result.lastInsertRowid), username, role });
    return Number(result.lastInsertRowid);
  });

  function createAdministrator(admin, actor = 'system') {
    const id = createAdministratorTransaction(admin, actor, true);
    return listAdministrators().find((entry) => entry.id === id);
  }

  const updateAdministratorTransaction = db.transaction((id, changes, actor) => {
    const current = db.prepare('SELECT * FROM administrators WHERE id = ?').get(Number(id));
    if (!current) throw new Error('Administrator not found.');
    const username = changes.username == null ? current.username : normalizeUsername(changes.username);
    const role = changes.role == null ? current.role : normalizeRole(changes.role);
    const discordId = changes.discordId == null ? current.discord_id : String(changes.discordId || '').trim() || null;
    const passwordHash = changes.passwordHash == null ? current.password_hash : String(changes.passwordHash || '').trim();
    if (!passwordHash) throw new Error('Administrator password hash is required.');
    if (current.role === 'lockdown' && role !== 'lockdown' && countLockdownAdministrators() <= 1) {
      throw new Error('The final lockdown administrator cannot be demoted.');
    }
    db.prepare(`
      UPDATE administrators
      SET username = ?, password_hash = ?, discord_id = ?, role = ?, updated_at = ?
      WHERE id = ?
    `).run(username, passwordHash, discordId, role, Date.now(), Number(id));
    writeAudit(actor, 'administrator.updated', { administratorId: Number(id), username, role, passwordChanged: changes.passwordHash != null });
  });

  function updateAdministrator(id, changes, actor) {
    updateAdministratorTransaction(id, changes || {}, actor || 'system');
    return listAdministrators().find((entry) => entry.id === Number(id));
  }

  const deleteAdministratorTransaction = db.transaction((id, actor) => {
    const current = db.prepare('SELECT * FROM administrators WHERE id = ?').get(Number(id));
    if (!current) throw new Error('Administrator not found.');
    if (current.role === 'lockdown' && countLockdownAdministrators() <= 1) {
      throw new Error('The final lockdown administrator cannot be removed.');
    }
    db.prepare('DELETE FROM administrators WHERE id = ?').run(Number(id));
    writeAudit(actor, 'administrator.deleted', { administratorId: Number(id), username: current.username, role: current.role });
  });

  function deleteAdministrator(id, actor = 'system') {
    deleteAdministratorTransaction(id, actor);
  }

  function isSetupComplete() {
    return countLockdownAdministrators() > 0;
  }

  function listAuditEvents({ limit = 200 } = {}) {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 200)));
    return db.prepare(`
      SELECT id, created_at, actor, action, details_json
      FROM administrative_audit_events
      ORDER BY id DESC
      LIMIT ?
    `).all(safeLimit).map((row) => ({
      id: Number(row.id),
      createdAt: Number(row.created_at),
      actor: row.actor,
      action: row.action,
      details: JSON.parse(row.details_json),
    }));
  }

  const importConfigurationFileTransaction = db.transaction(({ config, administrators, actor, source }) => {
    // A setup upload initializes an empty installation; it is deliberately not
    // a general-purpose replacement path for a running server's configuration.
    if (isSetupComplete()) throw new Error('A configuration file cannot replace an initialized installation.');
    const normalized = assertValidConfig(normalizeConfig(config));
    const revision = commitRevisionTransaction(normalized, {
      expectedRevision: getActiveConfigurationRecord().revision,
      actor,
      source,
    });
    administrators.forEach((admin) => createAdministratorTransaction(admin, actor, false));
    if (!isSetupComplete()) throw new Error('The configuration file must contain at least one lockdown administrator.');
    writeAudit(actor, 'setup.configuration-file-imported', { revision, administratorCount: administrators.length, source });
    return revision;
  });

  function importConfigurationFile(payload) {
    return importConfigurationFileTransaction(payload);
  }

  return {
    databasePath,
    getActiveConfigurationRecord,
    getClientConfiguration,
    updateConfiguration,
    listConfigurationRevisions,
    restoreConfigurationRevision,
    listAdministrators,
    findAdministratorForAuthentication,
    createAdministrator,
    updateAdministrator,
    deleteAdministrator,
    countLockdownAdministrators,
    isSetupComplete,
    listAuditEvents,
    importConfigurationFile,
    close: () => db.close(),
  };
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  createConfigurationDatabase,
  redactConfiguration,
};
