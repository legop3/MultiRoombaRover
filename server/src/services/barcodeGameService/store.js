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
    phase: 'idle',
    selectedGameId: null,
    runningGameId: null,
    voteEndsAt: null,
    joinEndsAt: null,
    startsAt: null,
    resultsUntil: null,
    resultGameId: null,
    resultDisplay: null,
    activeGameId: null,
    votes: {},
    globalCounters: {
      codes: {},
      objects: {},
      rovers: {},
    },
    recentRoverSightings: {},
    // roundParticipants persists only the current round's joined rovers/users.
    // It is separate from recentRoverSightings because the UI needs stable
    // participants for the whole round, while sightings expire quickly for
    // proximity attribution.
    roundParticipants: {},
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

function normalizePlayers(rawPlayers = {}) {
  const players = {};
  Object.entries(rawPlayers && typeof rawPlayers === 'object' ? rawPlayers : {}).forEach(([key, rawPlayer]) => {
    if (!key || !rawPlayer || typeof rawPlayer !== 'object') return;
    players[key] = {
      playerKey: typeof rawPlayer.playerKey === 'string' ? rawPlayer.playerKey : key,
      cookieUserId: typeof rawPlayer.cookieUserId === 'string' ? rawPlayer.cookieUserId : null,
      nickname: typeof rawPlayer.nickname === 'string' ? rawPlayer.nickname : null,
      lastRoverId: typeof rawPlayer.lastRoverId === 'string' ? rawPlayer.lastRoverId : null,
      totalPoints: Number.isFinite(rawPlayer.totalPoints) ? Math.max(0, Math.floor(rawPlayer.totalPoints)) : 0,
      lastSeenAt: Number.isFinite(rawPlayer.lastSeenAt) ? rawPlayer.lastSeenAt : null,
      games: rawPlayer.games && typeof rawPlayer.games === 'object' ? rawPlayer.games : {},
    };
  });
  return players;
}

function normalizeStoreShape(raw = {}) {
  const base = createDefaultStore();
  const votes = {};
  Object.entries(raw.votes && typeof raw.votes === 'object' ? raw.votes : {}).forEach(([key, rawVote]) => {
    const vote = normalizeVote(rawVote);
    if (vote) votes[key] = { ...vote, voterKey: vote.voterKey || key };
  });

  const phase = ['idle', 'voting', 'joining', 'starting', 'running', 'results'].includes(raw.phase)
    ? raw.phase
    : raw.activeGameId
      ? 'running'
      : 'idle';
  const runningGameId = typeof raw.runningGameId === 'string'
    ? raw.runningGameId
    : typeof raw.activeGameId === 'string'
      ? raw.activeGameId
      : null;

  return {
    ...base,
    version: STORE_VERSION,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    phase,
    selectedGameId: typeof raw.selectedGameId === 'string' ? raw.selectedGameId : runningGameId,
    runningGameId,
    voteEndsAt: Number.isFinite(raw.voteEndsAt) ? raw.voteEndsAt : null,
    joinEndsAt: Number.isFinite(raw.joinEndsAt) ? raw.joinEndsAt : null,
    startsAt: Number.isFinite(raw.startsAt) ? raw.startsAt : null,
    resultsUntil: Number.isFinite(raw.resultsUntil) ? raw.resultsUntil : null,
    resultGameId: typeof raw.resultGameId === 'string' ? raw.resultGameId : null,
    resultDisplay: raw.resultDisplay && typeof raw.resultDisplay === 'object' ? raw.resultDisplay : null,
    activeGameId: runningGameId,
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
    roundParticipants: raw.roundParticipants && typeof raw.roundParticipants === 'object' ? raw.roundParticipants : {},
    players: normalizePlayers(raw.players),
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
