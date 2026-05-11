// admin Reason Service
// Purpose: Defines the admin Reason Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fs = require('fs');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('adminReasonService');
const { isAdmin } = require('../roleService');
const { publishEvent } = require('../eventBus');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');

const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('admin-reason.json');
const MAX_REASON_LENGTH = 240;

let cache = null;

function loadStore() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    cache = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load admin reason', err.message);
    }
    cache = null;
  }
  return cache;
}

function saveStore(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  cache = next;
}

function normalizeText(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
}

function getAdminReason() {
  return loadStore();
}

function setAdminReason(text, meta = {}) {
  const clean = normalizeText(text);
  if (!clean) {
    throw new Error('Reason text required');
  }
  if (clean.length > MAX_REASON_LENGTH) {
    throw new Error(`Reason too long (max ${MAX_REASON_LENGTH} chars)`);
  }
  const payload = {
    text: clean,
    updatedAt: Date.now(),
    updatedBy: meta.by || null,
  };
  saveStore(payload);
  publishEvent({ source: 'adminReason', type: 'adminReason.updated', payload });
  return payload;
}

function clearAdminReason(meta = {}) {
  const payload = {
    text: null,
    updatedAt: Date.now(),
    updatedBy: meta.by || null,
  };
  saveStore(payload);
  publishEvent({ source: 'adminReason', type: 'adminReason.updated', payload });
  return payload;
}

io.on('connection', (socket) => {
  socket.on('adminReason:set', ({ text } = {}, cb = () => {}) => {
    if (!isAdmin(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      const result =
        text == null || String(text).trim() === ''
          ? clearAdminReason({ by: socket?.data?.user?.username || socket?.id })
          : setAdminReason(text, { by: socket?.data?.user?.username || socket?.id });
      cb({ success: true, reason: result });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

module.exports = {
  getAdminReason,
  setAdminReason,
  clearAdminReason,
};
