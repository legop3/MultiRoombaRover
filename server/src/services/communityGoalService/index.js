// community Goal Service
// Purpose: Defines the community Goal Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fs = require('fs');
const path = require('path');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('communityGoalService');
const { isAdmin } = require('../roleService');
const { publishEvent } = require('../eventBus');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'community-goal.json');
const MAX_GOAL_LENGTH = 240;

let cache = null;

function loadStore() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    cache = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load community goal', err.message);
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

function getCommunityGoal() {
  return loadStore();
}

function setCommunityGoal(text, meta = {}) {
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
  publishEvent({ source: 'communityGoal', type: 'communityGoal.updated', payload });
  return payload;
}

function clearCommunityGoal(meta = {}) {
  const payload = {
    text: null,
    updatedAt: Date.now(),
    updatedBy: meta.by || null,
  };
  saveStore(payload);
  publishEvent({ source: 'communityGoal', type: 'communityGoal.updated', payload });
  return payload;
}

io.on('connection', (socket) => {
  socket.on('communityGoal:set', ({ text } = {}, cb = () => {}) => {
    if (!isAdmin(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      const result =
        text == null || String(text).trim() === ''
          ? clearCommunityGoal({ by: socket?.data?.user?.username || socket?.id })
          : setCommunityGoal(text, { by: socket?.data?.user?.username || socket?.id });
      cb({ success: true, goal: result });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

module.exports = {
  getCommunityGoal,
  setCommunityGoal,
  clearCommunityGoal,
  MAX_GOAL_LENGTH,
};
