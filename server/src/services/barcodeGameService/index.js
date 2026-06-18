// Barcode Game Service
// Purpose: Coordinates global barcode games, voting, player attribution, and
// persistent scan counters for the scanner station.
// Scope: Keeps game orchestration server-side while the scanner and driver pages
// remain thin IO surfaces that subscribe to state and send votes/scans.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('barcodeGameService');
const { subscribe } = require('../eventBus');
const { getActiveDrivers } = require('../turnService');
const { getIdentitySummary } = require('../verificationService');
const { getRegistrySnapshot } = require('../barcodeScannerService');
const { loadStore, withGameStore } = require('./store');
const scanQuest = require('./games/scanQuest');
const scansPerSecond = require('./games/scansPerSecond');

const GAME_SOCKET_ROOM = 'barcode-game';
const RECENT_EVENT_LIMIT = 20;
const ROVER_ATTRIBUTION_WINDOW_MS = 60 * 1000;

const GAME_DEFINITIONS = [scanQuest, scansPerSecond];
const GAMES_BY_ID = Object.fromEntries(GAME_DEFINITIONS.map((game) => [game.id, game]));

function getGameDefinition(gameId) {
  return GAMES_BY_ID[String(gameId || '')] || null;
}

function getKnownObjects() {
  try {
    const snapshot = getRegistrySnapshot();
    const codes = snapshot?.registry?.codes || {};
    return Object.entries(codes)
      .filter(([, entry]) => entry?.type === 'object')
      .map(([code, entry]) => ({
        code,
        entityId: entry.entityId,
        label: entry.label,
      }));
  } catch (err) {
    logger.warn('Failed to read barcode registry for game object list', { error: err.message });
    return [];
  }
}

function normalizePlayerKey(identity = {}, socketId = '', roverId = '') {
  if (identity.cookieUserId) return `identity:${identity.cookieUserId}`;
  if (socketId) return `socket:${socketId}`;
  if (roverId) return `rover:${roverId}`;
  return null;
}

function resolveRoverParticipant(roverId) {
  const normalizedRoverId = String(roverId || '').trim();
  if (!normalizedRoverId) return null;
  const activeDrivers = getActiveDrivers();
  const socketId = activeDrivers?.[normalizedRoverId] || null;
  const socket = socketId ? io.sockets.sockets.get(socketId) : null;
  const identity = socket ? getIdentitySummary(socket) : {};
  const playerKey = normalizePlayerKey(identity, socketId, normalizedRoverId);

  return {
    playerKey,
    roverId: normalizedRoverId,
    socketId,
    cookieUserId: identity.cookieUserId || null,
    nickname: identity.nickname || normalizedRoverId,
  };
}

function pruneRecentRoverSightings(draft, now) {
  const sightings = draft.recentRoverSightings || {};
  Object.entries(sightings).forEach(([roverId, sighting]) => {
    if (!Number.isFinite(sighting?.scannedAt) || now - sighting.scannedAt > ROVER_ATTRIBUTION_WINDOW_MS) {
      delete sightings[roverId];
    }
  });
  draft.recentRoverSightings = sightings;
}

function recordRoverSighting(draft, scan, now) {
  if (!scan?.known || scan.type !== 'rover' || !scan.entityId) return null;
  const participant = resolveRoverParticipant(scan.entityId);
  if (!participant?.playerKey) return null;

  draft.recentRoverSightings = {
    ...(draft.recentRoverSightings || {}),
    [participant.roverId]: {
      ...participant,
      scannedAt: now,
    },
  };
  return participant;
}

function getProximityParticipants(draft, now) {
  pruneRecentRoverSightings(draft, now);
  return Object.values(draft.recentRoverSightings || {})
    .filter((sighting) => sighting?.playerKey && now - sighting.scannedAt <= ROVER_ATTRIBUTION_WINDOW_MS)
    .map((sighting) => ({
      playerKey: sighting.playerKey,
      roverId: sighting.roverId,
      socketId: sighting.socketId || null,
      cookieUserId: sighting.cookieUserId || null,
      nickname: sighting.nickname || sighting.roverId,
      scannedAt: sighting.scannedAt,
    }));
}

function incrementCounter(bucket, key, scan, now) {
  if (!key) return;
  const previous = bucket[key] || {};
  bucket[key] = {
    code: scan.code || previous.code || null,
    entityId: scan.entityId || previous.entityId || key,
    label: scan.label || previous.label || key,
    type: scan.type || previous.type || null,
    count: (Number.isFinite(previous.count) ? previous.count : 0) + 1,
    lastScannedAt: now,
  };
}

function updateGlobalCounters(draft, scan, now) {
  if (!scan?.known) return;
  const counters = draft.globalCounters || {};
  counters.codes = counters.codes || {};
  counters.objects = counters.objects || {};
  counters.rovers = counters.rovers || {};

  // Global counters intentionally ignore unknown scans. They are meant to be a
  // useful room/object popularity board, while game-specific rules can still
  // choose to count unknown codes when that makes sense.
  incrementCounter(counters.codes, scan.code, scan, now);
  if (scan.type === 'object') {
    incrementCounter(counters.objects, scan.entityId, scan, now);
  } else if (scan.type === 'rover') {
    incrementCounter(counters.rovers, scan.entityId, scan, now);
  }
  draft.globalCounters = counters;
}

function addRecentEvent(draft, event) {
  draft.recentEvents = [
    {
      ...event,
      at: Date.now(),
    },
    ...(Array.isArray(draft.recentEvents) ? draft.recentEvents : []),
  ].slice(0, RECENT_EVENT_LIMIT);
}

function recordPlayerParticipation(draft, gameId, participants, now) {
  if (!gameId || !Array.isArray(participants) || !participants.length) return;
  draft.players = draft.players || {};
  participants.forEach((participant) => {
    if (!participant?.playerKey) return;
    const previous = draft.players[participant.playerKey] || {};
    const previousGames = previous.games || {};
    const previousGame = previousGames[gameId] || {};
    draft.players[participant.playerKey] = {
      playerKey: participant.playerKey,
      cookieUserId: participant.cookieUserId || previous.cookieUserId || null,
      nickname: participant.nickname || previous.nickname || null,
      lastRoverId: participant.roverId || previous.lastRoverId || null,
      lastSeenAt: now,
      games: {
        ...previousGames,
        [gameId]: {
          gameId,
          scanCount: (Number.isFinite(previousGame.scanCount) ? previousGame.scanCount : 0) + 1,
          lastPlayedAt: now,
        },
      },
    };
  });
}

function ensureGameState(draft, gameId) {
  const definition = getGameDefinition(gameId);
  if (!definition) return null;
  draft.games = draft.games || {};
  draft.games[gameId] = definition.normalizeState
    ? definition.normalizeState(draft.games[gameId])
    : draft.games[gameId] || definition.createInitialState();
  return draft.games[gameId];
}

function buildGameContext(draft, extras = {}) {
  return {
    now: extras.now || Date.now(),
    objects: getKnownObjects(),
    participants: extras.participants || [],
  };
}

function activateGame(draft, gameId, now) {
  const definition = getGameDefinition(gameId);
  if (!definition) return false;
  const currentState = ensureGameState(draft, gameId);
  const nextState = definition.onActivated
    ? definition.onActivated(currentState, buildGameContext(draft, { now }))
    : currentState;
  draft.games[gameId] = nextState;
  draft.activeGameId = gameId;
  addRecentEvent(draft, {
    kind: 'gameActivated',
    gameId,
    title: definition.title,
  });
  return true;
}

function countVotes(votes = {}) {
  const counts = {};
  Object.values(votes || {}).forEach((vote) => {
    if (!getGameDefinition(vote?.gameId)) return;
    counts[vote.gameId] = (counts[vote.gameId] || 0) + 1;
  });
  return counts;
}

function chooseVoteWinner(draft) {
  const counts = countVotes(draft.votes);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [topGameId, topCount] = entries[0];
  const activeCount = draft.activeGameId ? counts[draft.activeGameId] || 0 : 0;

  // Ties keep the current game so a single equalizing vote does not cause the
  // room display to flicker back and forth between games.
  if (draft.activeGameId && activeCount === topCount) return draft.activeGameId;
  return topGameId;
}

function getVoterKey(socket) {
  const identity = getIdentitySummary(socket);
  return normalizePlayerKey(identity, socket?.id || '', '') || `socket:${socket?.id || 'unknown'}`;
}

function setVote(socket, gameId) {
  const definition = getGameDefinition(gameId);
  if (!definition) {
    return { error: 'unknown barcode game' };
  }
  const now = Date.now();
  const voterKey = getVoterKey(socket);
  const identity = getIdentitySummary(socket);

  withGameStore((draft) => {
    draft.votes = draft.votes || {};
    draft.votes[voterKey] = {
      gameId: definition.id,
      voterKey,
      socketId: socket.id,
      nickname: identity.nickname || null,
      votedAt: now,
    };

    const winner = chooseVoteWinner(draft);
    const existingWinnerState = winner ? draft.games?.[winner] : null;
    const shouldActivateWinner = Boolean(
      winner &&
        (!draft.activeGameId ||
          winner !== draft.activeGameId ||
          existingWinnerState?.status === 'ended' ||
          existingWinnerState?.status === 'idle'),
    );
    if (shouldActivateWinner) {
      activateGame(draft, winner, now);
    }
  });

  broadcastState();
  return { success: true, state: buildStatePayload() };
}

function settleActiveGameIfNeeded() {
  const store = loadStore();
  const activeGameId = store.activeGameId;
  const definition = getGameDefinition(activeGameId);
  const currentState = activeGameId ? store.games?.[activeGameId] : null;
  const now = Date.now();
  if (!definition?.onTick || currentState?.status !== 'running' || !currentState?.endsAt || now < currentState.endsAt) {
    return;
  }

  withGameStore((draft) => {
    const state = ensureGameState(draft, activeGameId);
    draft.games[activeGameId] = definition.onTick(state, buildGameContext(draft, { now }));
  });
}

function handleScan(scan) {
  const now = Number.isFinite(scan?.scannedAt) ? scan.scannedAt : Date.now();
  withGameStore((draft) => {
    updateGlobalCounters(draft, scan, now);
    recordRoverSighting(draft, scan, now);
    const participants = getProximityParticipants(draft, now);
    const activeGameId = draft.activeGameId;
    const definition = getGameDefinition(activeGameId);

    if (definition) {
      const currentState = ensureGameState(draft, activeGameId);
      const nextState = definition.onScan
        ? definition.onScan(currentState, scan, buildGameContext(draft, { now, participants }))
        : currentState;
      draft.games[activeGameId] = nextState;
      recordPlayerParticipation(draft, activeGameId, participants, now);
    }

    addRecentEvent(draft, {
      kind: 'scan',
      code: scan?.code || '',
      label: scan?.label || scan?.code || 'unknown',
      known: Boolean(scan?.known),
      type: scan?.type || null,
      participants: participants.map((participant) => participant.nickname || participant.roverId).filter(Boolean),
    });
  });
  broadcastState();
}

function topCounters(bucket = {}, limit = 5) {
  return Object.values(bucket || {})
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, limit);
}

function buildStatePayload() {
  settleActiveGameIfNeeded();
  const store = loadStore();
  const now = Date.now();
  const voteCounts = countVotes(store.votes);
  const activeDefinition = getGameDefinition(store.activeGameId);
  const context = buildGameContext(store, { now });
  const activeGame = activeDefinition
    ? activeDefinition.getPublicState(ensureReadonlyGameState(store, activeDefinition.id), context)
    : null;

  return {
    activeGameId: store.activeGameId,
    games: GAME_DEFINITIONS.map((game) => ({
      id: game.id,
      title: game.title,
      description: game.description,
      voteCount: voteCounts[game.id] || 0,
      active: game.id === store.activeGameId,
    })),
    activeGame,
    counters: {
      objects: topCounters(store.globalCounters?.objects),
      rovers: topCounters(store.globalCounters?.rovers),
      codes: topCounters(store.globalCounters?.codes),
    },
    recentEvents: Array.isArray(store.recentEvents) ? store.recentEvents.slice(0, 8) : [],
  };
}

function ensureReadonlyGameState(store, gameId) {
  const definition = getGameDefinition(gameId);
  if (!definition) return null;
  return definition.normalizeState ? definition.normalizeState(store.games?.[gameId]) : store.games?.[gameId] || null;
}

function broadcastState() {
  io.to(GAME_SOCKET_ROOM).emit('barcodeGame:state', buildStatePayload());
}

io.on('connection', (socket) => {
  socket.on('barcodeGame:subscribe', (_payload = {}, cb = () => {}) => {
    socket.join(GAME_SOCKET_ROOM);
    const state = buildStatePayload();
    socket.emit('barcodeGame:state', state);
    cb({ success: true, state });
  });

  socket.on('barcodeGame:vote', ({ gameId } = {}, cb = () => {}) => {
    try {
      cb(setVote(socket, gameId));
    } catch (err) {
      logger.warn('Barcode game vote failed', { error: err.message, gameId });
      cb({ error: err.message || 'barcode game vote failed' });
    }
  });
});

subscribe('barcode.scanned', (event) => {
  try {
    handleScan(event.payload);
  } catch (err) {
    // Scanner input should never be able to take down the server. Game failures
    // are logged and skipped so the scanner page can keep resolving barcodes.
    logger.warn('Barcode game scan handling failed', { error: err.message });
  }
});

module.exports = {
  buildStatePayload,
  handleScan,
  setVote,
};
