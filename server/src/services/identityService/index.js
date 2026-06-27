// Identity Service
// Purpose: Owns canonical user identity, strong identity signals, and per-user feature state.
// Scope: Keeps all user matching and identity persistence behind one API so other services never
// need to know whether a user was recognized by portable key, fingerprint, or a future signal.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const Database = require('better-sqlite3');
const { getSocketIp, normalizeIp } = require('../../helpers/ipResolver');
const { resolveDataPath } = require('../../helpers/dataPaths');
const logger = require('../../globals/logger').child('identityService');

const COOKIE_USER_ID_RE = /^cu_[a-f0-9]{32}$/;
const FINGERPRINT_ID_RE = /^tm_[a-z0-9_-]{8,256}$/;
const USER_ID_RE = /^usr_[a-f0-9]{32}$/;
const DB_PATH = resolveDataPath('identity.sqlite');
const LEGACY_VERIFICATION_PATH = resolveDataPath('verified-users.json');
const LEGACY_BARCODE_PATH = resolveDataPath('barcode-games.json');
const STORE_VERSION = 1;
const identityEvents = new EventEmitter();

let db = null;
let dbFileExistedAtOpen = false;

function nowMs() {
  return Date.now();
}

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\*/g, 'nope').slice(0, 32);
}

function normalizeCookieUserId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.toLowerCase();
}

function isValidCookieUserId(value) {
  return COOKIE_USER_ID_RE.test(normalizeCookieUserId(value));
}

function generateCookieUserId() {
  return `cu_${crypto.randomBytes(16).toString('hex')}`;
}

function normalizeFingerprintId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.toLowerCase();
}

function isValidFingerprintId(value) {
  return FINGERPRINT_ID_RE.test(normalizeFingerprintId(value));
}

function generateUserId() {
  return `usr_${crypto.randomBytes(16).toString('hex')}`;
}

function isValidUserId(value) {
  return USER_ID_RE.test(String(value || '').trim());
}

function getKnownIp(socket) {
  return normalizeIp(getSocketIp(socket));
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to read legacy JSON during identity import', { path: filePath, error: err.message });
    }
    return fallback;
  }
}

function encodeJson(value) {
  return JSON.stringify(value ?? null);
}

function decodeJson(raw, fallback = null) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getDb() {
  if (db) return db;

  dbFileExistedAtOpen = fs.existsSync(DB_PATH);
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);

  /*
    The legacy JSON files are intentionally read only when the SQLite database
    is first created. After that point this service treats identity.sqlite as
    the only source of truth, which prevents old files from silently overriding
    or re-importing live identity changes.
  */
  if (!dbFileExistedAtOpen) {
    migrateLegacyStores(db);
  }

  return db;
}

function ensureSchema(conn) {
  conn.exec(`
    create table if not exists users (
      id text primary key,
      created_at integer not null,
      updated_at integer not null,
      last_seen_at integer
    );

    create table if not exists user_cookie_ids (
      cookie_user_id text primary key,
      user_id text not null references users(id) on delete cascade,
      created_at integer not null,
      last_seen_at integer
    );
    create index if not exists idx_user_cookie_ids_user_id on user_cookie_ids(user_id);

    create table if not exists user_fingerprint_ids (
      fingerprint_id text primary key,
      user_id text not null references users(id) on delete cascade,
      created_at integer not null,
      last_seen_at integer
    );
    create index if not exists idx_user_fingerprint_ids_user_id on user_fingerprint_ids(user_id);

    create table if not exists user_nicknames (
      user_id text not null references users(id) on delete cascade,
      nickname text not null,
      first_seen_at integer not null,
      last_seen_at integer not null,
      primary key (user_id, nickname)
    );

    create table if not exists user_known_ips (
      user_id text not null references users(id) on delete cascade,
      ip text not null,
      first_seen_at integer not null,
      last_seen_at integer not null,
      primary key (user_id, ip)
    );

    create table if not exists user_status (
      user_id text primary key references users(id) on delete cascade,
      verified_enabled integer not null default 0,
      verified_at integer,
      verified_by text,
      deterrence_enabled integer not null default 0,
      deterrence_reason text,
      deterrence_at integer,
      deterrence_by text
    );

    create table if not exists verification_requests (
      id text primary key,
      user_id text references users(id) on delete set null,
      cookie_user_id text,
      fingerprint_id text,
      nickname text,
      ip text,
      socket_id text,
      status text not null,
      decision text,
      created_at integer not null,
      resolved_at integer,
      resolved_by text,
      legacy_json text
    );
    create index if not exists idx_verification_requests_user_status on verification_requests(user_id, status);

    create table if not exists verification_dm_messages (
      message_id text primary key,
      request_id text not null references verification_requests(id) on delete cascade,
      admin_discord_id text,
      created_at integer not null
    );

    create table if not exists user_feature_state (
      user_id text not null references users(id) on delete cascade,
      namespace text not null,
      data_json text not null,
      created_at integer not null,
      updated_at integer not null,
      primary key (user_id, namespace)
    );

    create table if not exists legacy_imports (
      source text not null,
      legacy_id text not null,
      user_id text references users(id) on delete set null,
      imported_at integer not null,
      data_json text,
      primary key (source, legacy_id)
    );

    pragma user_version = ${STORE_VERSION};
  `);
}

function createUser(conn = getDb(), ts = nowMs()) {
  const id = generateUserId();
  conn.prepare('insert into users (id, created_at, updated_at, last_seen_at) values (?, ?, ?, ?)').run(id, ts, ts, ts);
  conn.prepare('insert into user_status (user_id) values (?)').run(id);
  return id;
}

function ensureUserStatus(conn, userId) {
  conn.prepare('insert or ignore into user_status (user_id) values (?)').run(userId);
}

function findUserIdByCookie(conn, cookieUserId) {
  const key = normalizeCookieUserId(cookieUserId);
  if (!key) return null;
  return conn.prepare('select user_id from user_cookie_ids where cookie_user_id = ?').get(key)?.user_id || null;
}

function findUserIdByFingerprint(conn, fingerprintId) {
  const key = normalizeFingerprintId(fingerprintId);
  if (!key) return null;
  return conn.prepare('select user_id from user_fingerprint_ids where fingerprint_id = ?').get(key)?.user_id || null;
}

function mergeUsers(conn, targetUserId, sourceUserId) {
  if (!targetUserId || !sourceUserId || targetUserId === sourceUserId) return targetUserId || sourceUserId || null;
  const ts = nowMs();

  /*
    Identity equality is deliberately global: if two strong signals point at
    different users, those records represent the same person and must converge.
    Child tables are moved to the chosen target before the source row is deleted.
  */
  conn.prepare('update or ignore user_cookie_ids set user_id = ? where user_id = ?').run(targetUserId, sourceUserId);
  conn.prepare('delete from user_cookie_ids where user_id = ?').run(sourceUserId);
  conn.prepare('update or ignore user_fingerprint_ids set user_id = ? where user_id = ?').run(targetUserId, sourceUserId);
  conn.prepare('delete from user_fingerprint_ids where user_id = ?').run(sourceUserId);
  conn.prepare('update or ignore user_nicknames set user_id = ? where user_id = ?').run(targetUserId, sourceUserId);
  conn.prepare('delete from user_nicknames where user_id = ?').run(sourceUserId);
  conn.prepare('update or ignore user_known_ips set user_id = ? where user_id = ?').run(targetUserId, sourceUserId);
  conn.prepare('delete from user_known_ips where user_id = ?').run(sourceUserId);
  conn.prepare('update verification_requests set user_id = ? where user_id = ?').run(targetUserId, sourceUserId);
  conn.prepare('update legacy_imports set user_id = ? where user_id = ?').run(targetUserId, sourceUserId);

  const sourceStatus = conn.prepare('select * from user_status where user_id = ?').get(sourceUserId);
  ensureUserStatus(conn, targetUserId);
  if (sourceStatus?.verified_enabled) {
    conn.prepare(`
      update user_status
      set verified_enabled = 1,
          verified_at = coalesce(verified_at, ?),
          verified_by = coalesce(verified_by, ?)
      where user_id = ?
    `).run(sourceStatus.verified_at || ts, sourceStatus.verified_by || null, targetUserId);
  }
  if (sourceStatus?.deterrence_enabled) {
    conn.prepare(`
      update user_status
      set deterrence_enabled = 1,
          deterrence_reason = coalesce(deterrence_reason, ?),
          deterrence_at = coalesce(deterrence_at, ?),
          deterrence_by = coalesce(deterrence_by, ?)
      where user_id = ?
    `).run(sourceStatus.deterrence_reason || null, sourceStatus.deterrence_at || ts, sourceStatus.deterrence_by || null, targetUserId);
  }

  const sourceFeatures = conn.prepare('select namespace, data_json, created_at, updated_at from user_feature_state where user_id = ?').all(sourceUserId);
  sourceFeatures.forEach((feature) => {
    const existing = conn.prepare('select data_json, created_at from user_feature_state where user_id = ? and namespace = ?').get(targetUserId, feature.namespace);
    if (!existing) {
      conn.prepare(`
        insert into user_feature_state (user_id, namespace, data_json, created_at, updated_at)
        values (?, ?, ?, ?, ?)
      `).run(targetUserId, feature.namespace, feature.data_json, feature.created_at || ts, feature.updated_at || ts);
      return;
    }
    const merged = {
      ...(decodeJson(existing.data_json, {}) || {}),
      ...(decodeJson(feature.data_json, {}) || {}),
    };
    conn.prepare('update user_feature_state set data_json = ?, updated_at = ? where user_id = ? and namespace = ?')
      .run(encodeJson(merged), ts, targetUserId, feature.namespace);
  });

  conn.prepare('delete from user_feature_state where user_id = ?').run(sourceUserId);
  conn.prepare('delete from user_status where user_id = ?').run(sourceUserId);
  conn.prepare('delete from users where id = ?').run(sourceUserId);
  conn.prepare('update users set updated_at = ? where id = ?').run(ts, targetUserId);
  return targetUserId;
}

function resolveUserIdForIdentity(identity = {}, { create = true, conn = getDb() } = {}) {
  const cookieUserId = normalizeCookieUserId(identity.cookieUserId);
  const fingerprintId = normalizeFingerprintId(identity.fingerprintId);
  const cookieUser = cookieUserId ? findUserIdByCookie(conn, cookieUserId) : null;
  const fingerprintUser = fingerprintId ? findUserIdByFingerprint(conn, fingerprintId) : null;

  if (cookieUser && fingerprintUser) {
    return cookieUser === fingerprintUser ? cookieUser : mergeUsers(conn, cookieUser, fingerprintUser);
  }
  if (cookieUser || fingerprintUser) return cookieUser || fingerprintUser;
  return create ? createUser(conn) : null;
}

function attachIdentitySignals(userId, identity = {}, { conn = getDb(), ts = nowMs() } = {}) {
  if (!userId) return null;
  ensureUserStatus(conn, userId);

  const cookieUserId = normalizeCookieUserId(identity.cookieUserId);
  if (cookieUserId && isValidCookieUserId(cookieUserId)) {
    conn.prepare(`
      insert into user_cookie_ids (cookie_user_id, user_id, created_at, last_seen_at)
      values (?, ?, ?, ?)
      on conflict(cookie_user_id) do update set user_id = excluded.user_id, last_seen_at = excluded.last_seen_at
    `).run(cookieUserId, userId, ts, ts);
  }

  const fingerprintId = normalizeFingerprintId(identity.fingerprintId);
  if (fingerprintId && isValidFingerprintId(fingerprintId)) {
    conn.prepare(`
      insert into user_fingerprint_ids (fingerprint_id, user_id, created_at, last_seen_at)
      values (?, ?, ?, ?)
      on conflict(fingerprint_id) do update set user_id = excluded.user_id, last_seen_at = excluded.last_seen_at
    `).run(fingerprintId, userId, ts, ts);
  }

  const nickname = sanitizeNickname(identity.nickname);
  if (nickname) {
    conn.prepare(`
      insert into user_nicknames (user_id, nickname, first_seen_at, last_seen_at)
      values (?, ?, ?, ?)
      on conflict(user_id, nickname) do update set last_seen_at = excluded.last_seen_at
    `).run(userId, nickname, ts, ts);
  }

  const ip = normalizeIp(identity.ip);
  if (ip) {
    conn.prepare(`
      insert into user_known_ips (user_id, ip, first_seen_at, last_seen_at)
      values (?, ?, ?, ?)
      on conflict(user_id, ip) do update set last_seen_at = excluded.last_seen_at
    `).run(userId, ip, ts, ts);
  }

  conn.prepare('update users set updated_at = ?, last_seen_at = ? where id = ?').run(ts, ts, userId);
  return getUserById(userId, { conn });
}

function normalizeSocketIdentity(socket, payload = {}) {
  const data = socket?.data || {};
  return {
    cookieUserId: normalizeCookieUserId(payload.cookieUserId || data.cookieUserId),
    fingerprintId: normalizeFingerprintId(payload.fingerprintId || data.fingerprintId),
    nickname: sanitizeNickname(payload.nickname || data.nickname),
    ip: payload.ip || getKnownIp(socket),
  };
}

function setSocketIdentityState(socket, user, identity = {}) {
  if (!socket || !user) return;
  socket.data = socket.data || {};
  socket.data.userId = user.id;
  socket.data.cookieUserId = normalizeCookieUserId(identity.cookieUserId) || user.cookieUserIds[0] || '';
  socket.data.fingerprintId = normalizeFingerprintId(identity.fingerprintId) || user.fingerprintIds[0] || '';
  socket.data.isVerified = Boolean(user.verified?.enabled);
  socket.data.verifiedRecordId = user.verified?.enabled ? user.id : null;
  socket.data.isDeterred = Boolean(user.deterrence?.enabled);
  socket.data.deterredRecordId = user.deterrence?.enabled ? user.id : null;
}

function identifySocket(socket, payload = {}) {
  if (!socket) throw new Error('Socket required');
  const conn = getDb();
  const ts = nowMs();
  socket.data = socket.data || {};

  let cookieUserId = normalizeCookieUserId(payload.cookieUserId || socket.data.cookieUserId);
  if (cookieUserId && !isValidCookieUserId(cookieUserId)) {
    throw new Error('Invalid identity key format.');
  }
  if (!cookieUserId) cookieUserId = generateCookieUserId();

  const fingerprintId = normalizeFingerprintId(payload.fingerprintId || socket.data.fingerprintId);
  if (fingerprintId && !isValidFingerprintId(fingerprintId)) {
    throw new Error('Invalid fingerprint format.');
  }

  const identity = {
    cookieUserId,
    fingerprintId,
    nickname: sanitizeNickname(payload.nickname || socket.data.nickname),
    ip: getKnownIp(socket),
  };

  const user = conn.transaction(() => {
    const userId = resolveUserIdForIdentity(identity, { create: true, conn });
    return attachIdentitySignals(userId, identity, { conn, ts });
  })();

  setSocketIdentityState(socket, user, identity);
  identityEvents.emit('change', { reason: 'identify', socketId: socket.id, userId: user.id });
  return {
    user,
    userId: user.id,
    cookieUserId,
    fingerprintId: fingerprintId || null,
    isVerified: Boolean(user.verified?.enabled),
    isDeterred: Boolean(user.deterrence?.enabled),
  };
}

function getRows(conn, sql, params = []) {
  return conn.prepare(sql).all(...params);
}

function getUserById(userId, { conn = getDb(), includeFeatures = true } = {}) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const row = conn.prepare('select * from users where id = ?').get(id);
  if (!row) return null;
  const status = conn.prepare('select * from user_status where user_id = ?').get(id) || {};
  const features = {};
  if (includeFeatures) {
    getRows(conn, 'select namespace, data_json from user_feature_state where user_id = ?', [id]).forEach((feature) => {
      features[feature.namespace] = decodeJson(feature.data_json, {});
    });
  }
  const nicknames = getRows(conn, 'select nickname from user_nicknames where user_id = ? order by last_seen_at desc', [id])
    .map((entry) => entry.nickname);
  const knownIps = getRows(conn, 'select ip from user_known_ips where user_id = ? order by last_seen_at desc', [id])
    .map((entry) => entry.ip);
  return {
    id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    cookieUserIds: getRows(conn, 'select cookie_user_id from user_cookie_ids where user_id = ? order by last_seen_at desc', [id])
      .map((entry) => entry.cookie_user_id),
    fingerprintIds: getRows(conn, 'select fingerprint_id from user_fingerprint_ids where user_id = ? order by last_seen_at desc', [id])
      .map((entry) => entry.fingerprint_id),
    nicknames,
    knownIps,
    nickname: nicknames[0] || null,
    knownIp: knownIps[0] || null,
    verified: {
      enabled: Boolean(status.verified_enabled),
      at: status.verified_at || null,
      by: status.verified_by || null,
    },
    deterrence: {
      enabled: Boolean(status.deterrence_enabled),
      reason: status.deterrence_reason || null,
      at: status.deterrence_at || null,
      by: status.deterrence_by || null,
    },
    features,
  };
}

function getUserForSocket(socket) {
  if (!socket?.data?.userId) return null;
  return getUserById(socket.data.userId);
}

function getUserIdForSocket(socket) {
  return socket?.data?.userId || null;
}

function getIdentitySummary(socket) {
  const user = getUserForSocket(socket);
  const data = socket?.data || {};
  return {
    userId: user?.id || data.userId || null,
    cookieUserId: normalizeCookieUserId(data.cookieUserId) || user?.cookieUserIds?.[0] || null,
    fingerprintId: normalizeFingerprintId(data.fingerprintId) || user?.fingerprintIds?.[0] || null,
    nickname: user?.nickname || null,
    overseerEnabled: typeof data.overseerEnabled === 'boolean' ? data.overseerEnabled : true,
  };
}

function getFeatureState(userId, namespace, defaults = {}) {
  const id = String(userId || '').trim();
  const ns = String(namespace || '').trim();
  if (!id || !ns) return defaults;
  const row = getDb().prepare('select data_json from user_feature_state where user_id = ? and namespace = ?').get(id, ns);
  return row ? decodeJson(row.data_json, defaults) : defaults;
}

function setFeatureState(userId, namespace, nextState) {
  const id = String(userId || '').trim();
  const ns = String(namespace || '').trim();
  if (!id || !ns) throw new Error('userId and namespace required');
  const ts = nowMs();
  getDb().prepare(`
    insert into user_feature_state (user_id, namespace, data_json, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(user_id, namespace) do update set data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(id, ns, encodeJson(nextState || {}), ts, ts);
  identityEvents.emit('change', { reason: 'feature_state', userId: id, namespace: ns });
  return nextState || {};
}

function updateFeatureState(userId, namespace, updater, defaults = {}) {
  const current = getFeatureState(userId, namespace, defaults);
  const next = typeof updater === 'function' ? updater(current) : updater;
  return setFeatureState(userId, namespace, next);
}

function listFeatureStates(namespace) {
  const ns = String(namespace || '').trim();
  if (!ns) return [];
  return getDb().prepare(`
    select user_id, data_json, created_at, updated_at
    from user_feature_state
    where namespace = ?
    order by updated_at desc
  `).all(ns).map((row) => ({
    userId: row.user_id,
    state: decodeJson(row.data_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function setVerified(userId, { enabled = true, actor = null, at = nowMs() } = {}) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('userId required');
  ensureUserStatus(getDb(), id);
  getDb().prepare(`
    update user_status
    set verified_enabled = ?, verified_at = ?, verified_by = ?
    where user_id = ?
  `).run(enabled ? 1 : 0, enabled ? at : null, enabled ? actor : null, id);
  identityEvents.emit('change', { reason: enabled ? 'verified' : 'verification_removed', userId: id });
  return getUserById(id);
}

function setDeterrence(userId, { enabled = true, reason = null, actor = null, at = nowMs() } = {}) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('userId required');
  ensureUserStatus(getDb(), id);
  getDb().prepare(`
    update user_status
    set deterrence_enabled = ?, deterrence_reason = ?, deterrence_at = ?, deterrence_by = ?
    where user_id = ?
  `).run(enabled ? 1 : 0, enabled ? reason : null, enabled ? at : null, enabled ? actor : null, id);
  identityEvents.emit('change', { reason: enabled ? 'deterred' : 'undeterred', userId: id });
  return getUserById(id);
}

function isVerified(socket) {
  return Boolean(socket?.data?.isVerified);
}

function isDeterred(socket) {
  return Boolean(socket?.data?.isDeterred);
}

function listUsers({ verified = null, deterred = null } = {}) {
  const conn = getDb();
  let sql = 'select users.id from users join user_status on user_status.user_id = users.id';
  const where = [];
  if (verified !== null) where.push(`user_status.verified_enabled = ${verified ? 1 : 0}`);
  if (deterred !== null) where.push(`user_status.deterrence_enabled = ${deterred ? 1 : 0}`);
  if (where.length) sql += ` where ${where.join(' and ')}`;
  sql += ' order by users.updated_at desc';
  return conn.prepare(sql).all().map((row) => getUserById(row.id, { conn, includeFeatures: false }));
}

function userToLegacyIdentityEntry(user) {
  return {
    id: user.id,
    userId: user.id,
    cookieUserId: user.cookieUserIds[0] || null,
    fingerprintId: user.fingerprintIds[0] || null,
    fingerprintIds: user.fingerprintIds,
    nickname: user.nickname || null,
    knownIps: user.knownIps,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    approvedBy: user.verified?.by || null,
    reason: user.deterrence?.reason || null,
  };
}

function listVerifiedUsers() {
  return listUsers({ verified: true }).map(userToLegacyIdentityEntry);
}

function listDeterredUsers() {
  return listUsers({ deterred: true }).map(userToLegacyIdentityEntry);
}

function resolveUserBySelector(selector, { includeDeterred = true, includeVerified = true } = {}) {
  const value = String(selector || '').trim();
  if (!value) return { error: 'selector_required' };
  const conn = getDb();

  if (isValidUserId(value)) {
    const user = getUserById(value, { conn });
    if (user) return { user };
  }

  const cookie = normalizeCookieUserId(value);
  if (cookie && isValidCookieUserId(cookie)) {
    const userId = findUserIdByCookie(conn, cookie);
    if (userId) return { user: getUserById(userId, { conn }) };
  }

  const fingerprint = normalizeFingerprintId(value);
  if (fingerprint && isValidFingerprintId(fingerprint)) {
    const userId = findUserIdByFingerprint(conn, fingerprint);
    if (userId) return { user: getUserById(userId, { conn }) };
  }

  const nickname = sanitizeNickname(value);
  if (nickname) {
    const rows = conn.prepare(`
      select distinct user_nicknames.user_id
      from user_nicknames
      join user_status on user_status.user_id = user_nicknames.user_id
      where lower(user_nicknames.nickname) = lower(?)
        and (? = 1 or user_status.verified_enabled = 1)
        and (? = 1 or user_status.deterrence_enabled = 1)
    `).all(nickname, includeVerified ? 1 : 0, includeDeterred ? 1 : 0);
    if (rows.length === 1) return { user: getUserById(rows[0].user_id, { conn }) };
    if (rows.length > 1) return { error: 'ambiguous_nickname' };
  }

  return { error: 'not_found' };
}

function recordLegacyImport(conn, source, legacyId, userId, data) {
  const id = String(legacyId || '').trim();
  if (!source || !id) return;
  conn.prepare(`
    insert or ignore into legacy_imports (source, legacy_id, user_id, imported_at, data_json)
    values (?, ?, ?, ?, ?)
  `).run(source, id, userId || null, nowMs(), encodeJson(data || {}));
}

function importVerifiedUsers(conn, legacyStore) {
  (Array.isArray(legacyStore.verifiedUsers) ? legacyStore.verifiedUsers : []).forEach((entry) => {
    const cookieUserId = normalizeCookieUserId(entry.cookieUserId);
    const identity = {
      cookieUserId: isValidCookieUserId(cookieUserId) ? cookieUserId : '',
      nickname: entry.nickname,
      ip: Array.isArray(entry.knownIps) ? entry.knownIps[0] : null,
    };
    const userId = resolveUserIdForIdentity(identity, { create: true, conn });
    attachIdentitySignals(userId, identity, { conn, ts: entry.updatedAt || entry.createdAt || nowMs() });
    (Array.isArray(entry.knownIps) ? entry.knownIps : []).forEach((ip) => {
      attachIdentitySignals(userId, { ip }, { conn, ts: entry.updatedAt || nowMs() });
    });
    setVerified(userId, {
      enabled: true,
      actor: entry.approvedBy || null,
      at: entry.createdAt || entry.updatedAt || nowMs(),
    });
    recordLegacyImport(conn, 'verifiedUsers', entry.id || cookieUserId, userId, entry);
  });
}

function importDeterredUsers(conn, legacyStore) {
  (Array.isArray(legacyStore.deterredUsers) ? legacyStore.deterredUsers : []).forEach((entry) => {
    const cookieUserId = normalizeCookieUserId(entry.cookieUserId);
    const identity = {
      cookieUserId: isValidCookieUserId(cookieUserId) ? cookieUserId : '',
      nickname: entry.nickname,
      ip: Array.isArray(entry.knownIps) ? entry.knownIps[0] : null,
    };
    const userId = resolveUserIdForIdentity(identity, { create: true, conn });
    attachIdentitySignals(userId, identity, { conn, ts: entry.updatedAt || entry.createdAt || nowMs() });
    (Array.isArray(entry.knownIps) ? entry.knownIps : []).forEach((ip) => {
      attachIdentitySignals(userId, { ip }, { conn, ts: entry.updatedAt || nowMs() });
    });
    setDeterrence(userId, {
      enabled: true,
      reason: entry.reason || null,
      actor: entry.updatedBy || entry.createdBy || null,
      at: entry.updatedAt || entry.createdAt || nowMs(),
    });
    recordLegacyImport(conn, 'deterredUsers', entry.id || cookieUserId || crypto.randomBytes(8).toString('hex'), userId, entry);
  });
}

function importVerificationRequests(conn, legacyStore) {
  (Array.isArray(legacyStore.pendingRequests) ? legacyStore.pendingRequests : []).forEach((request) => {
    const cookieUserId = normalizeCookieUserId(request.cookieUserId);
    const userId = cookieUserId && isValidCookieUserId(cookieUserId)
      ? resolveUserIdForIdentity({ cookieUserId, nickname: request.nickname, ip: request.ip }, { create: true, conn })
      : null;
    if (userId) attachIdentitySignals(userId, { cookieUserId, nickname: request.nickname, ip: request.ip }, { conn, ts: request.createdAt || nowMs() });
    conn.prepare(`
      insert or ignore into verification_requests
        (id, user_id, cookie_user_id, fingerprint_id, nickname, ip, socket_id, status, decision, created_at, resolved_at, resolved_by, legacy_json)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.id,
      userId,
      cookieUserId || null,
      normalizeFingerprintId(request.fingerprintId) || null,
      sanitizeNickname(request.nickname) || null,
      normalizeIp(request.ip) || null,
      request.socketId || null,
      request.status || 'pending',
      request.decision || null,
      request.createdAt || nowMs(),
      request.resolvedAt || null,
      request.resolvedBy || null,
      encodeJson(request),
    );
    recordLegacyImport(conn, 'pendingRequests', request.id, userId, request);
  });

  (Array.isArray(legacyStore.dmMessages) ? legacyStore.dmMessages : []).forEach((entry) => {
    if (!entry.messageId || !entry.requestId) return;
    conn.prepare(`
      insert or ignore into verification_dm_messages (message_id, request_id, admin_discord_id, created_at)
      values (?, ?, ?, ?)
    `).run(entry.messageId, entry.requestId, entry.adminDiscordId || null, entry.createdAt || nowMs());
    recordLegacyImport(conn, 'verificationDmMessages', entry.messageId, null, entry);
  });
}

function importBarcodePlayers(conn, barcodeStore) {
  const players = barcodeStore?.players && typeof barcodeStore.players === 'object' ? barcodeStore.players : {};
  Object.entries(players).forEach(([playerKey, player]) => {
    const fromField = normalizeCookieUserId(player?.cookieUserId);
    const fromKey = String(playerKey || '').startsWith('identity:')
      ? normalizeCookieUserId(String(playerKey).slice('identity:'.length))
      : '';
    const cookieUserId = isValidCookieUserId(fromField) ? fromField : isValidCookieUserId(fromKey) ? fromKey : '';
    if (!cookieUserId) {
      recordLegacyImport(conn, 'barcodePlayersOrphan', playerKey, null, player);
      return;
    }
    const userId = resolveUserIdForIdentity({ cookieUserId, nickname: player.nickname }, { create: true, conn });
    attachIdentitySignals(userId, { cookieUserId, nickname: player.nickname }, { conn, ts: player.lastSeenAt || nowMs() });
    updateFeatureState(userId, 'barcodeGames', (current) => ({
      ...(current || {}),
      playerKeys: Array.from(new Set([...(current?.playerKeys || []), playerKey])),
      cookieUserId,
      nickname: player.nickname || current?.nickname || null,
      lastRoverId: player.lastRoverId || current?.lastRoverId || null,
      totalPoints: Math.max(Number(current?.totalPoints || 0), Number(player.totalPoints || 0)),
      lastSeenAt: Math.max(Number(current?.lastSeenAt || 0), Number(player.lastSeenAt || 0)) || null,
      games: {
        ...(current?.games || {}),
        ...(player.games || {}),
      },
    }), {});
    recordLegacyImport(conn, 'barcodePlayers', playerKey, userId, player);
  });
}

function migrateLegacyStores(conn) {
  const migrated = conn.transaction(() => {
    const legacyVerification = readJsonFile(LEGACY_VERIFICATION_PATH, {});
    const legacyBarcode = readJsonFile(LEGACY_BARCODE_PATH, {});
    importVerifiedUsers(conn, legacyVerification);
    importDeterredUsers(conn, legacyVerification);
    importVerificationRequests(conn, legacyVerification);
    importBarcodePlayers(conn, legacyBarcode);
  });

  migrated();
  logger.info('Identity SQLite store initialized from legacy files once', { path: DB_PATH });
}

/*
  createJsonStore remains exported for the older non-identity stores that use a
  small JSON file. It is not used by the new user identity database.
*/
function createJsonStore({ path: filePath, normalizeStoreShape, cloneStore, logger: storeLogger }) {
  let cache = null;

  function loadStore() {
    if (cache) return cache;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      cache = normalizeStoreShape(JSON.parse(raw));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        storeLogger?.warn?.('Failed to load JSON store', { path: filePath, error: err.message });
      }
      cache = normalizeStoreShape({});
    }
    return cache;
  }

  function writeStore(next) {
    const normalized = normalizeStoreShape(next);
    fs.mkdirSync(require('path').dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
    cache = normalized;
    return cache;
  }

  function withStore(mutator) {
    const current = loadStore();
    const draft = cloneStore(current);
    const result = mutator(draft);
    writeStore(draft);
    return result;
  }

  return {
    loadStore,
    writeStore,
    withStore,
  };
}

module.exports = {
  identityEvents,
  getDb,
  sanitizeNickname,
  normalizeCookieUserId,
  isValidCookieUserId,
  generateCookieUserId,
  normalizeFingerprintId,
  isValidFingerprintId,
  generateUserId,
  getKnownIp,
  identifySocket,
  normalizeSocketIdentity,
  resolveUserIdForIdentity,
  attachIdentitySignals,
  getUserById,
  getUserForSocket,
  getUserIdForSocket,
  getIdentitySummary,
  getFeatureState,
  setFeatureState,
  updateFeatureState,
  listFeatureStates,
  setVerified,
  setDeterrence,
  isVerified,
  isDeterred,
  listVerifiedUsers,
  listDeterredUsers,
  resolveUserBySelector,
  userToLegacyIdentityEntry,
  createJsonStore,
};
