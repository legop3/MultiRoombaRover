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
const GAME_TICK_MS = 5 * 1000;
const VOTING_WINDOW_MS = 10 * 1000;
const STARTING_WINDOW_MS = 5 * 1000;
const RESULTS_WINDOW_MS = 45 * 1000;

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

function normalizeIdentityPlayerKey(identity = {}) {
  // Permanent scoring is identity-only. Socket and rover IDs are useful runtime
  // evidence, but they are unstable and should not create leaderboard entries.
  return identity.cookieUserId ? `identity:${identity.cookieUserId}` : null;
}

function resolveRoverParticipant(roverId) {
  const normalizedRoverId = String(roverId || '').trim();
  if (!normalizedRoverId) return null;
  const activeDrivers = getActiveDrivers();
  const socketId = activeDrivers?.[normalizedRoverId] || null;
  const socket = socketId ? io.sockets.sockets.get(socketId) : null;
  const identity = socket ? getIdentitySummary(socket) : {};
  const playerKey = normalizeIdentityPlayerKey(identity);

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
    if (!participant?.playerKey || !String(participant.playerKey).startsWith('identity:')) return;
    const previous = draft.players[participant.playerKey] || {};
    const previousGames = previous.games || {};
    const previousGame = previousGames[gameId] || {};
    draft.players[participant.playerKey] = {
      playerKey: participant.playerKey,
      cookieUserId: participant.cookieUserId || previous.cookieUserId || null,
      nickname: participant.nickname || previous.nickname || null,
      lastRoverId: participant.roverId || previous.lastRoverId || null,
      totalPoints: Number.isFinite(previous.totalPoints) ? previous.totalPoints : 0,
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

function applyPointAwards(draft, gameId, awards = [], now) {
  if (!gameId || !Array.isArray(awards) || !awards.length) return;
  draft.players = draft.players || {};

  awards.forEach((award) => {
    const playerKey = award?.playerKey;
    const points = Number.isFinite(award?.points) ? Math.max(0, Math.floor(award.points)) : 0;
    if (!playerKey || !String(playerKey).startsWith('identity:') || !points) return;

    const previous = draft.players[playerKey] || {};
    const previousGames = previous.games || {};
    const previousGame = previousGames[gameId] || {};

    // Global points are applied only here so individual game files cannot drift
    // into different player-ledger formats. A game simply returns awards, and
    // the shared service records identity, total points, and per-game totals in
    // one persistent place.
    draft.players[playerKey] = {
      playerKey,
      cookieUserId: award.cookieUserId || previous.cookieUserId || null,
      nickname: award.nickname || previous.nickname || null,
      lastRoverId: award.roverId || previous.lastRoverId || null,
      totalPoints: (Number.isFinite(previous.totalPoints) ? previous.totalPoints : 0) + points,
      lastSeenAt: now,
      games: {
        ...previousGames,
        [gameId]: {
          ...previousGame,
          gameId,
          points: (Number.isFinite(previousGame.points) ? previousGame.points : 0) + points,
          awards: (Number.isFinite(previousGame.awards) ? previousGame.awards : 0) + 1,
          lastAwardAt: now,
          lastReason: award.reason || null,
        },
      },
    };

    addRecentEvent(draft, {
      kind: 'pointsAwarded',
      gameId,
      playerKey,
      nickname: award.nickname || previous.nickname || null,
      points,
      reason: award.reason || null,
    });
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

function startGame(draft, gameId, now) {
  const definition = getGameDefinition(gameId);
  if (!definition) return false;
  const currentState = ensureGameState(draft, gameId);
  const nextState = definition.start
    ? definition.start(currentState, buildGameContext(draft, { now }))
    : definition.activate
      ? definition.activate(currentState, buildGameContext(draft, { now }))
    : currentState;
  draft.games[gameId] = nextState;
  draft.phase = 'running';
  draft.runningGameId = gameId;
  draft.selectedGameId = gameId;
  draft.activeGameId = gameId;
  draft.voteEndsAt = null;
  draft.startsAt = null;
  draft.resultsUntil = null;
  draft.resultGameId = null;
  draft.resultDisplay = null;
  addRecentEvent(draft, {
    kind: 'gameStarted',
    gameId,
    title: definition.title,
  });
  return true;
}

function normalizeGameResult(result, fallbackState) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { state: fallbackState, awards: [] };
  }
  if (Object.prototype.hasOwnProperty.call(result, 'state')) {
    return {
      state: result.state,
      awards: Array.isArray(result.awards) ? result.awards : [],
      done: Boolean(result.done),
      display: result.display && typeof result.display === 'object' ? result.display : null,
    };
  }
  return { state: result, awards: [], done: false, display: null };
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
  const selectedCount = draft.selectedGameId ? counts[draft.selectedGameId] || 0 : 0;

  // Ties keep the currently selected pending game so a single equalizing vote
  // does not make the room display flicker during the voting window.
  if (draft.selectedGameId && selectedCount === topCount) return draft.selectedGameId;
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
  const current = loadStore();
  if (current.phase === 'running' || current.phase === 'starting') {
    return { error: 'a barcode game is already starting or running' };
  }

  withGameStore((draft) => {
    draft.votes = draft.votes || {};
    draft.votes[voterKey] = {
      gameId: definition.id,
      voterKey,
      socketId: socket.id,
      nickname: identity.nickname || null,
      votedAt: now,
    };

    const winner = chooseVoteWinner(draft) || definition.id;
    draft.selectedGameId = winner;
    if (draft.phase === 'idle' || draft.phase === 'results') {
      draft.phase = 'voting';
      draft.voteEndsAt = now + VOTING_WINDOW_MS;
      draft.startsAt = null;
      draft.runningGameId = null;
      draft.activeGameId = null;
      draft.resultsUntil = null;
      draft.resultDisplay = null;
    } else if (draft.phase === 'voting') {
      draft.voteEndsAt = Math.max(draft.voteEndsAt || 0, now + VOTING_WINDOW_MS);
    }
  });

  broadcastState();
  return { success: true, state: buildStatePayload(socket) };
}

function settleActiveGameIfNeeded() {
  const store = loadStore();
  const now = Date.now();
  const phase = store.phase || 'idle';

  if (phase === 'voting' && store.voteEndsAt && now >= store.voteEndsAt) {
    const winner = chooseVoteWinner(store) || store.selectedGameId;
    if (!getGameDefinition(winner)) return false;
    withGameStore((draft) => {
      draft.selectedGameId = winner;
      draft.phase = 'starting';
      draft.startsAt = now + STARTING_WINDOW_MS;
      draft.voteEndsAt = null;
      addRecentEvent(draft, {
        kind: 'gameStarting',
        gameId: winner,
        title: getGameDefinition(winner)?.title,
      });
    });
    return true;
  }

  if (phase === 'starting' && store.startsAt && now >= store.startsAt) {
    const gameId = store.selectedGameId;
    if (!getGameDefinition(gameId)) return false;
    withGameStore((draft) => {
      startGame(draft, gameId, now);
    });
    return true;
  }

  if (phase === 'results' && store.resultsUntil && now >= store.resultsUntil) {
    withGameStore((draft) => {
      draft.phase = 'idle';
      draft.selectedGameId = null;
      draft.runningGameId = null;
      draft.activeGameId = null;
      draft.voteEndsAt = null;
      draft.startsAt = null;
      draft.resultsUntil = null;
      draft.resultGameId = null;
      draft.resultDisplay = null;
      draft.votes = {};
    });
    return true;
  }

  const activeGameId = store.phase === 'running' ? store.runningGameId : null;
  const definition = getGameDefinition(activeGameId);
  const currentState = activeGameId ? store.games?.[activeGameId] : null;
  if (!definition?.tick || !currentState) return false;

  const normalizedState = ensureReadonlyGameState(store, activeGameId);
  const gameResult = definition.tick(normalizedState, buildGameContext(store, { now }));
  const { state: nextState, awards, done, display } = normalizeGameResult(gameResult, normalizedState);
  if (JSON.stringify(nextState) === JSON.stringify(normalizedState) && !done) return false;

  withGameStore((draft) => {
    draft.games[activeGameId] = nextState;
    applyPointAwards(draft, activeGameId, awards, now);
    if (done) {
      const publicState = definition.getPublicState
        ? definition.getPublicState(nextState, buildGameContext(draft, { now }))
        : null;
      draft.phase = 'results';
      draft.resultGameId = activeGameId;
      draft.resultDisplay = display || publicState?.display || null;
      draft.resultsUntil = now + RESULTS_WINDOW_MS;
      draft.runningGameId = null;
      draft.activeGameId = null;
      draft.startsAt = null;
      draft.voteEndsAt = null;
      draft.votes = {};
    }
  });
  return true;
}

function handleScan(scan) {
  const now = Number.isFinite(scan?.scannedAt) ? scan.scannedAt : Date.now();
  withGameStore((draft) => {
    updateGlobalCounters(draft, scan, now);
    recordRoverSighting(draft, scan, now);
    const participants = getProximityParticipants(draft, now);
    const activeGameId = draft.phase === 'running' ? draft.runningGameId : null;
    const definition = getGameDefinition(activeGameId);

    if (definition) {
      const currentState = ensureGameState(draft, activeGameId);
      const gameResult = definition.handleScan
        ? definition.handleScan(currentState, scan, buildGameContext(draft, { now, participants }))
        : currentState;
      const { state: nextState, awards, done, display } = normalizeGameResult(gameResult, currentState);
      draft.games[activeGameId] = nextState;
      recordPlayerParticipation(draft, activeGameId, participants, now);
      applyPointAwards(draft, activeGameId, awards, now);
      if (done) {
        const publicState = definition.getPublicState
          ? definition.getPublicState(nextState, buildGameContext(draft, { now }))
          : null;
        draft.phase = 'results';
        draft.resultGameId = activeGameId;
        draft.resultDisplay = display || publicState?.display || null;
        draft.resultsUntil = now + RESULTS_WINDOW_MS;
        draft.runningGameId = null;
        draft.activeGameId = null;
        draft.startsAt = null;
        draft.voteEndsAt = null;
        draft.votes = {};
      }
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

function getPlayerForSocket(store, socket) {
  if (!socket) return null;
  const identity = getIdentitySummary(socket);
  const playerKey = normalizeIdentityPlayerKey(identity);
  const player = playerKey ? store.players?.[playerKey] || null : null;
  if (!player) {
    return {
      playerKey,
      nickname: identity.nickname || null,
      totalPoints: 0,
      rank: null,
      games: {},
    };
  }
  const rankedPlayers = Object.values(store.players || {})
    .filter((entry) => String(entry?.playerKey || '').startsWith('identity:') && Number.isFinite(entry?.totalPoints) && entry.totalPoints > 0)
    .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  const rank = rankedPlayers.findIndex((entry) => entry.playerKey === player.playerKey) + 1;
  return {
    playerKey: player.playerKey,
    nickname: player.nickname || identity.nickname || null,
    totalPoints: player.totalPoints || 0,
    rank: rank > 0 ? rank : null,
    games: player.games || {},
  };
}

function buildStatePayload(socket = null) {
  settleActiveGameIfNeeded();
  const store = loadStore();
  const now = Date.now();
  const voteCounts = countVotes(store.votes);
  const selectedDefinition = getGameDefinition(store.selectedGameId);
  const runningDefinition = getGameDefinition(store.runningGameId);
  const context = buildGameContext(store, { now });
  const runningGame = runningDefinition
    ? runningDefinition.getPublicState(ensureReadonlyGameState(store, runningDefinition.id), context)
    : null;
  const activeGame = buildLifecycleGameState(store, {
    now,
    selectedDefinition,
    runningDefinition,
    runningGame,
    voteCounts,
  });
  const leaderboard = topPlayers(store.players);

  return {
    phase: store.phase,
    selectedGameId: store.selectedGameId,
    runningGameId: store.runningGameId,
    activeGameId: store.runningGameId,
    games: GAME_DEFINITIONS.map((game) => ({
      id: game.id,
      title: game.title,
      description: game.description,
      voteCount: voteCounts[game.id] || 0,
      active: game.id === store.runningGameId,
      selected: game.id === store.selectedGameId,
      actionLabel: store.phase === 'idle' || store.phase === 'results' ? 'Vote' : game.id === store.selectedGameId ? 'Selected' : 'Vote',
    })),
    activeGame,
    leaderboard,
    ownPlayer: getPlayerForSocket(store, socket),
    counters: {
      objects: topCounters(store.globalCounters?.objects),
      rovers: topCounters(store.globalCounters?.rovers),
      codes: topCounters(store.globalCounters?.codes),
    },
    recentEvents: Array.isArray(store.recentEvents) ? store.recentEvents.slice(0, 8) : [],
  };
}

function buildLifecycleGameState(store, { now, selectedDefinition, runningDefinition, runningGame, voteCounts }) {
  if (store.phase === 'running' && runningGame) return runningGame;
  if (store.phase === 'results') {
    return {
      id: store.resultGameId,
      title: getGameDefinition(store.resultGameId)?.title || 'Results',
      status: 'results',
      display: {
        title: 'Results',
        primary: store.resultDisplay?.primary || 'Round complete',
        secondary: store.resultDisplay?.secondary || 'Vote to start another game',
        timer: store.resultsUntil ? { label: 'Results clear in', endsAt: store.resultsUntil } : null,
        stats: store.resultDisplay?.stats || [],
        results: store.resultDisplay?.results || [],
      },
    };
  }
  if (store.phase === 'starting') {
    return {
      id: store.selectedGameId,
      title: selectedDefinition?.title || 'Starting',
      status: 'starting',
      display: {
        title: 'Starting',
        primary: selectedDefinition ? `${selectedDefinition.title} starts soon` : 'Game starts soon',
        secondary: 'Get ready',
        timer: store.startsAt ? { label: 'Starts in', endsAt: store.startsAt } : null,
        stats: [],
        results: [],
      },
    };
  }
  if (store.phase === 'voting') {
    const selectedTitle = selectedDefinition?.title || 'a barcode game';
    return {
      id: store.selectedGameId,
      title: 'Voting',
      status: 'voting',
      display: {
        title: 'Voting',
        primary: `Voting for ${selectedTitle}`,
        secondary: 'Most votes starts the next game',
        timer: store.voteEndsAt ? { label: 'Voting ends in', endsAt: store.voteEndsAt } : null,
        stats: GAME_DEFINITIONS.map((game) => ({
          label: game.title,
          value: voteCounts[game.id] || 0,
        })),
        results: [],
      },
    };
  }
  return {
    id: null,
    title: 'Barcode games',
    status: 'idle',
    display: {
      title: 'Barcode games',
      primary: 'Choose a game',
      secondary: 'Vote to start the next round',
      timer: null,
      stats: [],
      results: [],
    },
  };
}

function topPlayers(players = {}, limit = 6) {
  return Object.values(players || {})
    .filter((player) => String(player?.playerKey || '').startsWith('identity:') && Number.isFinite(player?.totalPoints) && player.totalPoints > 0)
    .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
    .slice(0, limit)
    .map((player) => ({
      playerKey: player.playerKey,
      nickname: player.nickname || player.lastRoverId || 'unknown player',
      totalPoints: player.totalPoints || 0,
      lastRoverId: player.lastRoverId || null,
    }));
}

function ensureReadonlyGameState(store, gameId) {
  const definition = getGameDefinition(gameId);
  if (!definition) return null;
  return definition.normalizeState ? definition.normalizeState(store.games?.[gameId]) : store.games?.[gameId] || null;
}

function broadcastState() {
  const room = io.sockets.adapter.rooms.get(GAME_SOCKET_ROOM);
  if (!room) return;
  room.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('barcodeGame:state', buildStatePayload(socket));
    }
  });
}

io.on('connection', (socket) => {
  socket.on('barcodeGame:subscribe', (_payload = {}, cb = () => {}) => {
    socket.join(GAME_SOCKET_ROOM);
    const state = buildStatePayload(socket);
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

setInterval(() => {
  if (settleActiveGameIfNeeded()) {
    broadcastState();
  }
}, GAME_TICK_MS).unref?.();
