// identity Service
// Purpose: Defines the identity Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fs = require('fs');
const crypto = require('crypto');
const { getSocketIp, normalizeIp } = require('../../helpers/ipResolver');

const COOKIE_USER_ID_RE = /^cu_[a-f0-9]{32}$/;

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

function getKnownIp(socket) {
  return normalizeIp(getSocketIp(socket));
}

function createJsonStore({ path, normalizeStoreShape, cloneStore, logger }) {
  let cache = null;

  function loadStore() {
    if (cache) return cache;
    try {
      const raw = fs.readFileSync(path, 'utf8');
      cache = normalizeStoreShape(JSON.parse(raw));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger?.warn?.('Failed to load JSON store', { path, error: err.message });
      }
      cache = normalizeStoreShape({});
    }
    return cache;
  }

  function writeStore(next) {
    const normalized = normalizeStoreShape(next);
    fs.mkdirSync(require('path').dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, path);
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
  sanitizeNickname,
  normalizeCookieUserId,
  isValidCookieUserId,
  generateCookieUserId,
  getKnownIp,
  createJsonStore,
};
