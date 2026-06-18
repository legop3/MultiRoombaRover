// Barcode Game Store
// Purpose: Owns persisted barcode game state and normalizes it on every load.
// Scope: Keeps file IO and state-shape repair separate from the game engine so
// individual games can focus on rules instead of persistence details.
const { createJsonStore } = require('../identityService');
const { resolveDataPath } = require('../../helpers/dataPaths');
const logger = require('../../globals/logger').child('barcodeGameStore');

const STORE_VERSION = 1;
const STORE_PATH = resolveDataPath('barcode-games.json');

function createDefaultStore() {
  return {
    version: STORE_VERSION,
    updatedAt: Date.now(),
    activeGameId: null,
    votes: {},
    globalCounters: {
      codes: {},
      objects: {},
      rovers: {},
    },
    recentRoverSightings: {},
    players: {},
    games: {},
    recentEvents: [],
  };
}

function cloneStore(store) {
  // The game state is intentionally JSON-shaped because it must survive server
  // restarts without custom serializers. JSON cloning is sufficient and keeps
  // accidental mutable references from leaking between callers.
  return JSON.parse(JSON.stringify(store || createDefaultStore()));
}

function normalizeCounterBucket(rawBucket = {}) {
  const bucket = {};
  Object.entries(rawBucket && typeof rawBucket === 'object' ? rawBucket : {}).forEach(([key, rawEntry]) => {
    if (!key || !rawEntry || typeof rawEntry !== 'object') return;
    const count = Number.isFinite(rawEntry.count) ? Math.max(0, Math.floor(rawEntry.count)) : 0;
    if (!count) return;
    bucket[key] = {
      code: typeof rawEntry.code === 'string' ? rawEntry.code : null,
      entityId: typeof rawEntry.entityId === 'string' ? rawEntry.entityId : key,
      label: typeof rawEntry.label === 'string' ? rawEntry.label : key,
      type: typeof rawEntry.type === 'string' ? rawEntry.type : null,
      count,
      lastScannedAt: Number.isFinite(rawEntry.lastScannedAt) ? rawEntry.lastScannedAt : null,
    };
  });
  return bucket;
}

function normalizeVote(rawVote = {}) {
  const gameId = typeof rawVote.gameId === 'string' ? rawVote.gameId : null;
  if (!gameId) return null;
  return {
    gameId,
    voterKey: typeof rawVote.voterKey === 'string' ? rawVote.voterKey : null,
    nickname: typeof rawVote.nickname === 'string' ? rawVote.nickname : null,
    socketId: typeof rawVote.socketId === 'string' ? rawVote.socketId : null,
    votedAt: Number.isFinite(rawVote.votedAt) ? rawVote.votedAt : Date.now(),
  };
}

function normalizeStoreShape(raw = {}) {
  const base = createDefaultStore();
  const votes = {};
  Object.entries(raw.votes && typeof raw.votes === 'object' ? raw.votes : {}).forEach(([key, rawVote]) => {
    const vote = normalizeVote(rawVote);
    if (vote) votes[key] = { ...vote, voterKey: vote.voterKey || key };
  });

  return {
    ...base,
    version: STORE_VERSION,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    activeGameId: typeof raw.activeGameId === 'string' ? raw.activeGameId : null,
    votes,
    globalCounters: {
      codes: normalizeCounterBucket(raw.globalCounters?.codes),
      objects: normalizeCounterBucket(raw.globalCounters?.objects),
      rovers: normalizeCounterBucket(raw.globalCounters?.rovers),
    },
    recentRoverSightings:
      raw.recentRoverSightings && typeof raw.recentRoverSightings === 'object'
        ? raw.recentRoverSightings
        : {},
    players: raw.players && typeof raw.players === 'object' ? raw.players : {},
    games: raw.games && typeof raw.games === 'object' ? raw.games : {},
    recentEvents: Array.isArray(raw.recentEvents) ? raw.recentEvents.slice(-25) : [],
  };
}

const storeApi = createJsonStore({
  path: STORE_PATH,
  normalizeStoreShape,
  cloneStore,
  logger,
});

function writeStore(next) {
  return storeApi.writeStore({
    ...next,
    updatedAt: Date.now(),
  });
}

function withGameStore(mutator) {
  const current = storeApi.loadStore();
  const draft = cloneStore(current);
  const result = mutator(draft);
  writeStore(draft);
  return result;
}

module.exports = {
  STORE_PATH,
  loadStore: storeApi.loadStore,
  writeStore,
  withGameStore,
  cloneStore,
};
