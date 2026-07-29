// Fun Stats Service
// Purpose: Persists the running counters behind the social `rs` fun commands.
// Scope: Owns storage and clamping only; command handlers decide what a counter means.
const fs = require('fs');
const path = require('path');
const logger = require('../../globals/logger').child('funStatsService');
const { resolveDataPath } = require('../../helpers/dataPaths');

const STORE_PATH = resolveDataPath('fun-stats.json');

// Counters are additive and never authoritative for anything but bragging
// rights, so the ceiling only exists to keep a runaway loop from writing an
// unbounded integer into the store.
const MAX_COUNT = 1_000_000;
const MAX_LABEL_LENGTH = 64;
const ACTOR_COUNTERS = [
  'bonksGiven',
  'bonksTaken',
  'hugsGiven',
  'hugsTaken',
  'slapsGiven',
  'slapsTaken',
];

/*
  This service deliberately keeps its own tiny JSON store rather than reusing
  identityService.createJsonStore. Fun counters are keyed by an actor key that
  spans transports (`user:<id>` for site chat, `discord:<id>` for Discord), and
  a Discord id has no row in `users`, so it cannot live in `user_feature_state`
  without violating that table's foreign key. Keeping storage local also means
  the counters can be unit tested without opening the identity database.
*/
let cache = null;

function clampCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), MAX_COUNT);
}

function normalizeLabel(value) {
  const label = String(value || '').trim().replace(/\s+/g, ' ');
  if (!label) return null;
  return label.slice(0, MAX_LABEL_LENGTH);
}

function normalizeActor(raw = {}) {
  const actor = { label: normalizeLabel(raw.label) };
  ACTOR_COUNTERS.forEach((key) => {
    actor[key] = clampCount(raw[key]);
  });
  actor.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : null;
  return actor;
}

function normalizeStore(raw = {}) {
  const actors = {};
  const rawActors = raw && typeof raw.actors === 'object' && raw.actors ? raw.actors : {};
  Object.keys(rawActors).forEach((key) => {
    const actorKey = String(key || '').trim();
    if (!actorKey) return;
    actors[actorKey] = normalizeActor(rawActors[actorKey]);
  });

  const rovers = {};
  const rawRovers = raw && typeof raw.rovers === 'object' && raw.rovers ? raw.rovers : {};
  Object.keys(rawRovers).forEach((key) => {
    const roverId = String(key || '').trim();
    if (!roverId) return;
    const entry = rawRovers[roverId] || {};
    rovers[roverId] = {
      pets: clampCount(entry.pets),
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : null,
    };
  });

  return { actors, rovers };
}

function loadState() {
  if (cache) return cache;
  try {
    cache = normalizeStore(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load fun stats store', { path: STORE_PATH, error: err.message });
    }
    cache = normalizeStore({});
  }
  return cache;
}

function persistState(next) {
  const normalized = normalizeStore(next);
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, STORE_PATH);
  } catch (err) {
    // A failed write must not break the command that triggered it. The joke
    // still lands; only the tally is lost.
    logger.warn('Failed to persist fun stats store', { path: STORE_PATH, error: err.message });
  }
  cache = normalized;
  return cache;
}

function getActorStats(actorKey) {
  const key = String(actorKey || '').trim();
  if (!key) return normalizeActor({});
  return { ...(loadState().actors[key] || normalizeActor({})) };
}

/*
  `patch` is a map of counter name to increment. Unknown counter names are
  ignored rather than stored so a typo in a handler cannot quietly create a
  parallel counter that never shows up on the leaderboard.
*/
function bumpActorStats(actorKey, { label = null, ...patch } = {}) {
  const key = String(actorKey || '').trim();
  if (!key) return normalizeActor({});
  const state = loadState();
  const current = state.actors[key] || normalizeActor({});
  const next = { ...current };
  const resolvedLabel = normalizeLabel(label);
  if (resolvedLabel) next.label = resolvedLabel;
  ACTOR_COUNTERS.forEach((counter) => {
    const delta = Number(patch[counter]);
    if (!Number.isFinite(delta) || delta === 0) return;
    next[counter] = clampCount(current[counter] + delta);
  });
  next.updatedAt = Date.now();
  persistState({ ...state, actors: { ...state.actors, [key]: next } });
  return { ...next };
}

function listActorStats() {
  const { actors } = loadState();
  return Object.keys(actors).map((actorKey) => ({ actorKey, ...actors[actorKey] }));
}

function bumpRoverPets(roverId, by = 1) {
  const id = String(roverId || '').trim();
  if (!id) return 0;
  const state = loadState();
  const current = state.rovers[id] || { pets: 0, updatedAt: null };
  const delta = Number(by);
  const next = {
    pets: clampCount(current.pets + (Number.isFinite(delta) ? delta : 0)),
    updatedAt: Date.now(),
  };
  persistState({ ...state, rovers: { ...state.rovers, [id]: next } });
  return next.pets;
}

function getRoverPets(roverId) {
  const id = String(roverId || '').trim();
  if (!id) return 0;
  return loadState().rovers[id]?.pets || 0;
}

// Tests drive the store through a temporary SERVER_DATA_DIR, so they need a way
// to drop the module-level cache between cases.
function resetCacheForTests() {
  cache = null;
}

module.exports = {
  ACTOR_COUNTERS,
  STORE_PATH,
  getActorStats,
  bumpActorStats,
  listActorStats,
  bumpRoverPets,
  getRoverPets,
  resetCacheForTests,
};
