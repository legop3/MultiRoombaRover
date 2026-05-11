// Global Objective Service
// Purpose: Defines the global objective service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fs = require('fs');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('globalObjectiveService');
const { isAdmin } = require('../roleService');
const { publishEvent } = require('../eventBus');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');

const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('global-objective.json');
const MAX_GOAL_LENGTH = 240;

let cache = null;

function loadStore() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    cache = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load global objective', err.message);
    }
    if (!cache) cache = null;
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

function getGlobalObjective() {
  return loadStore();
}

function setGlobalObjective(text, meta = {}) {
  const clean = normalizeText(text);
  if (!clean) {
    throw new Error('Goal text required');
  }
  if (clean.length > MAX_GOAL_LENGTH) {
    throw new Error(`Goal too long (max ${MAX_GOAL_LENGTH} chars)`);
  }
  const payload = {
    text: clean,
    updatedAt: Date.now(),
    updatedBy: meta.by || null,
  };
  saveStore(payload);
  publishEvent({ source: 'globalObjective', type: 'globalObjective.updated', payload });
  return payload;
}

function clearGlobalObjective(meta = {}) {
  const payload = {
    text: null,
    updatedAt: Date.now(),
    updatedBy: meta.by || null,
  };
  saveStore(payload);
  publishEvent({ source: 'globalObjective', type: 'globalObjective.updated', payload });
  return payload;
}

io.on('connection', (socket) => {
  socket.on('globalObjective:set', ({ text } = {}, cb = () => {}) => {
    if (!isAdmin(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      const result =
        text == null || String(text).trim() === ''
          ? clearGlobalObjective({ by: socket?.data?.user?.username || socket?.id })
          : setGlobalObjective(text, { by: socket?.data?.user?.username || socket?.id });
      cb({ success: true, goal: result });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

module.exports = {
  getGlobalObjective,
  setGlobalObjective,
  clearGlobalObjective,
};
