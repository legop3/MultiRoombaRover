// Chat Service State
// Purpose: Stores mutable chat runtime state for rate limits, history, and typing bookkeeping.
// Scope: Encapsulates in-memory collections shared by chat service modules.
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, MAX_HISTORY } = require('./constants');

const rateBuckets = new Map();
const history = [];
const lastMessageBySocket = new Map();
const typingBySocket = new Map();
let lastAccessNoticeAt = 0;

function withinRateLimit(socketId) {
  const now = Date.now();
  const entries = rateBuckets.get(socketId) || [];
  const next = entries.filter((ts) => now - ts <= RATE_LIMIT_WINDOW_MS);
  next.push(now);
  rateBuckets.set(socketId, next);
  return next.length <= RATE_LIMIT_MAX;
}

function pushHistory(message) {
  history.push(message);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function getRecentMessages(limit = 20, options = {}) {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  const includeSystem = options?.includeSystem !== false;
  const source = includeSystem ? history : history.filter((entry) => !entry?.system);
  return source.slice(-safeLimit);
}

function getLastAccessNoticeAt() {
  return lastAccessNoticeAt;
}

function setLastAccessNoticeAt(ts) {
  lastAccessNoticeAt = ts;
}

module.exports = {
  rateBuckets,
  history,
  lastMessageBySocket,
  typingBySocket,
  withinRateLimit,
  pushHistory,
  getRecentMessages,
  getLastAccessNoticeAt,
  setLastAccessNoticeAt,
};
