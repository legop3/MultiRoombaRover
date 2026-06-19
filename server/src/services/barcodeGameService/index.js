// Barcode Game Service
// Purpose: Coordinates global barcode games, voting, player attribution, and
// persistent scan counters for the scanner station.
// Scope: Keeps game orchestration server-side while the scanner and driver pages
// remain thin IO surfaces that subscribe to state and send votes/scans.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('barcodeGameService');
const { loadConfig } = require('../../helpers/configLoader');
const { subscribe } = require('../eventBus');
const { sendSystemMessage } = require('../chatService');
const { getActiveDrivers } = require('../turnService');
const { getIdentitySummary } = require('../verificationService');
const { getRegistrySnapshot } = require('../barcodeScannerService');
const { loadStore, withGameStore } = require('./store');
const scanQuest = require('./games/scanQuest');
const scansPerSecond = require('./games/scansPerSecond');
const mostItems = require('./games/mostItems');

const GAME_SOCKET_ROOM = 'barcode-game';
const RECENT_EVENT_LIMIT = 20;
const ROVER_ATTRIBUTION_WINDOW_MS = 60 * 1000;
const GAME_TICK_MS = 5 * 1000;
const VOTING_WINDOW_MS = 10 * 1000;
const JOIN_WINDOW_MS = 30 * 1000;
const STARTING_WINDOW_MS = 5 * 1000;
const RESULTS_WINDOW_MS = 45 * 1000;

const GAME_DEFINITIONS = [scanQuest, scansPerSecond, mostItems];
const GAMES_BY_ID = Object.fromEntries(GAME_DEFINITIONS.map((game) => [game.id, game]));
const config = loadConfig();
const barcodeGamesConfig = config.barcodeGames || {};
const botName = String(barcodeGamesConfig.botName || barcodeGamesConfig.name || 'Barcode Games').trim() || 'Barcode Games';
const botProfileImageUrl = String(barcodeGamesConfig.profileImageUrl || '').trim() || null;

function sendBarcodeGameChat(text) {
  const message = String(text || '').trim();
  if (!message) return null;
  // Barcode game lifecycle messages use the same internal chat path as the
  // Overseer bot. Keeping this as a local helper makes the transition code
  // explicit while preserving the chat service's normal bot/profile handling.
  return sendSystemMessage(message, {
    nickname: botName,
    bot: true,
    profileImage: botProfileImageUrl,
  });
}

function formatList(items = [], limit = 5) {
  // Chat messages should stay readable in the normal feed. This helper keeps
  // every lifecycle message to a short list while still making it obvious when
  // more players or stats existed than could fit comfortably in one message.
  const values = items
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!values.length) return '';

  const visible = values.slice(0, limit);
  const extraCount = values.length - visible.length;
  const suffix = extraCount > 0 ? `, and ${extraCount} more` : '';
  return `${visible.join(', ')}${suffix}`;
}

function getParticipantName(participant = {}) {
  return participant.nickname || participant.roverId || participant.participantKey || '';
}

function formatParticipantSummary(participants = []) {
  const names = formatList(participants.map(getParticipantName));
  return names || 'no counted rovers yet';
}

function formatVoteSummary(votes = {}, selectedGameId = null) {
  const counts = countVotes(votes);
  const selectedVotes = selectedGameId ? counts[selectedGameId] || 0 : 0;
  const totalVotes = Object.values(counts).reduce((sum, count) => sum + count, 0);

  // The selected vote count matters more than a full per-game breakdown in
  // chat. The detailed vote buttons still show every game, while the bot gives
  // enough context to explain why this specific game moved to joining.
  if (!totalVotes) return 'No votes were counted';
  if (selectedVotes === totalVotes) {
    return `${selectedVotes} ${selectedVotes === 1 ? 'vote' : 'votes'}`;
  }
  return `${selectedVotes} of ${totalVotes} ${totalVotes === 1 ? 'vote' : 'votes'}`;
}

function normalizeAwardSummaries(awards = []) {
  const totalsByPlayer = {};

  awards.forEach((award) => {
    const playerKey = award?.playerKey;
    const points = Number.isFinite(award?.points) ? Math.max(0, Math.floor(award.points)) : 0;
    // applyPointAwards uses this same identity-only rule. Repeating it here
    // prevents the bot from claiming that a rover-only participant earned
    // leaderboard points when the persistent ledger intentionally ignored it.
    if (!playerKey || !String(playerKey).startsWith('identity:') || !points) return;
    const previous = totalsByPlayer[playerKey] || {};
    totalsByPlayer[playerKey] = {
      playerKey,
      nickname: award.nickname || previous.nickname || award.roverId || 'unknown player',
      roverId: award.roverId || previous.roverId || null,
      points: (Number.isFinite(previous.points) ? previous.points : 0) + points,
    };
  });

  return Object.values(totalsByPlayer).sort((a, b) => (b.points || 0) - (a.points || 0));
}

function formatAwardSummary(awards = []) {
  const summaries = normalizeAwardSummaries(awards);
  if (!summaries.length) return '';

  // Award packets are the most authoritative source for point changes because
  // they are what the shared ledger actually applies. The formatter groups
  // multiple awards per player so chat does not spam one line per scan.
  return formatList(
    summaries.map((award) => `${award.nickname || award.roverId} scored ${award.points} ${award.points === 1 ? 'point' : 'points'}`),
    5,
  );
}

function formatPublicScoreSummary(publicState = {}) {
  const scoreEntries = Array.isArray(publicState?.scores)
    ? publicState.scores
    : Array.isArray(publicState?.finalResult?.participants)
      ? publicState.finalResult.participants
      : [];

  const summaries = scoreEntries
    .map((entry) => {
      // Public game state is less authoritative than award packets, but it is
      // still valuable for games that award throughout the round. The formatter
      // accepts both point-shaped and scan-count-shaped entries so game modules
      // can expose natural result data without chat-specific contracts.
      const points = Number.isFinite(entry?.points) ? Math.max(0, Math.floor(entry.points)) : null;
      const scanCount = Number.isFinite(entry?.scanCount) ? Math.max(0, Math.floor(entry.scanCount)) : null;
      const name = entry?.nickname || entry?.roverId || entry?.playerKey || '';

      if (!name) return null;
      if (points !== null && points > 0) {
        return `${name} scored ${points} ${points === 1 ? 'point' : 'points'}`;
      }
      if (scanCount !== null && scanCount > 0) {
        return `${name} made ${scanCount} ${scanCount === 1 ? 'scan' : 'scans'}`;
      }
      return null;
    })
    .filter(Boolean);

  // Some games, like scan quest, award during the round instead of returning a
  // final award packet. Their public state still carries round scores, so this
  // gives the bot a useful end summary without making each game hand-write chat.
  return formatList(summaries, 5);
}

function formatResultSummary(display = {}) {
  const primary = String(display?.primary || '').trim();
  const usefulStats = Array.isArray(display?.stats)
    ? display.stats
        .map((stat) => {
          const label = String(stat?.label || '').trim();
          const value = String(stat?.value ?? '').trim();
          if (!label || !value) return '';
          return `${label}: ${value}`;
        })
        .filter(Boolean)
    : [];

  return formatList([primary, ...usefulStats], 3);
}

function sendGameStartChat(definition, participants = []) {
  const title = definition?.title || 'Barcode game';
  const participantSummary = formatParticipantSummary(participants);
  sendBarcodeGameChat(`${title} has started with ${participantSummary}.`);
}

function sendGameEndChat(definition, { display = null, publicState = null, awards = [], participants = [] } = {}) {
  const title = definition?.title || 'Barcode game';
  const awardSummary = formatAwardSummary(awards) || formatPublicScoreSummary(publicState);
  const resultSummary = formatResultSummary(display || publicState?.display || {});
  const participantSummary = formatParticipantSummary(participants);
  const details = [
    resultSummary,
    awardSummary || `Played by ${participantSummary}`,
  ].filter(Boolean);

  // End messages intentionally combine game-provided results with shared ledger
  // awards. That keeps the bot useful for both end-scored games and games that
  // score during play while still avoiding game-specific chat code.
  sendBarcodeGameChat(`${title} ended. ${details.join(' ') || 'Results are now showing.'}`);
}

function getGameDefinition(gameId) {
  return GAMES_BY_ID[String(gameId || '')] || null;
}

function normalizeRgbChannel(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function getGameThemeColor(definition) {
  const raw = definition?.themeColor;
  const r = normalizeRgbChannel(raw?.r);
  const g = normalizeRgbChannel(raw?.g);
  const b = normalizeRgbChannel(raw?.b);

  // Games own their visual identity, but the socket payload should always be a
  // small safe RGB object. Invalid or missing values fall back to neutral text
  // colors in the browser instead of leaking arbitrary styling data into React.
  if (r === null || g === null || b === null) return null;
  return { r, g, b };
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
    // participantKey is the runtime round key. It can fall back to the rover ID
    // so the UI can show that a physical rover joined even if the driver has no
    // verified identity yet. playerKey stays identity-only because persistent
    // scoring should not create separate leaderboard rows for sockets or rovers.
    participantKey: playerKey || `rover:${normalizedRoverId}`,
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
  if (!participant?.participantKey) return null;

  draft.recentRoverSightings = {
    ...(draft.recentRoverSightings || {}),
    [participant.roverId]: {
      ...participant,
      scannedAt: now,
    },
  };
  return participant;
}

function recordRoundParticipant(draft, participant, now) {
  if (!participant?.participantKey) return null;
  const previous = draft.roundParticipants?.[participant.participantKey] || {};

  draft.roundParticipants = {
    ...(draft.roundParticipants || {}),
    [participant.participantKey]: {
      participantKey: participant.participantKey,
      playerKey: participant.playerKey || previous.playerKey || null,
      roverId: participant.roverId || previous.roverId || null,
      socketId: participant.socketId || previous.socketId || null,
      cookieUserId: participant.cookieUserId || previous.cookieUserId || null,
      nickname: participant.nickname || previous.nickname || participant.roverId || 'unknown player',
      joinedAt: Number.isFinite(previous.joinedAt) ? previous.joinedAt : now,
      lastSeenAt: now,
      scanCount: (Number.isFinite(previous.scanCount) ? previous.scanCount : 0) + 1,
    },
  };

  return draft.roundParticipants[participant.participantKey];
}

function getRoundParticipants(draft) {
  return Object.values(draft.roundParticipants || {})
    .filter((participant) => participant?.participantKey)
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
    .map((participant) => ({
      participantKey: participant.participantKey,
      playerKey: participant.playerKey || null,
      roverId: participant.roverId || null,
      socketId: participant.socketId || null,
      cookieUserId: participant.cookieUserId || null,
      nickname: participant.nickname || participant.roverId || 'unknown player',
      joinedAt: Number.isFinite(participant.joinedAt) ? participant.joinedAt : null,
      lastSeenAt: Number.isFinite(participant.lastSeenAt) ? participant.lastSeenAt : null,
      scanCount: Number.isFinite(participant.scanCount) ? participant.scanCount : 0,
    }));
}

function getProximityParticipants(draft, now) {
  pruneRecentRoverSightings(draft, now);
  return Object.values(draft.recentRoverSightings || {})
    .filter((sighting) => sighting?.participantKey && now - sighting.scannedAt <= ROVER_ATTRIBUTION_WINDOW_MS)
    .map((sighting) => ({
      participantKey: sighting.participantKey,
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
    participants: extras.participants || getRoundParticipants(draft),
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
  draft.joinEndsAt = null;
  draft.startsAt = null;
  draft.resultsUntil = null;
  draft.resultGameId = null;
  draft.resultDisplay = null;
  addRecentEvent(draft, {
    kind: 'gameStarted',
    gameId,
    title: definition.title,
  });
  sendGameStartChat(definition, getRoundParticipants(draft));
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
  if (current.phase === 'joining' || current.phase === 'starting' || current.phase === 'running') {
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
      draft.joinEndsAt = null;
      draft.startsAt = null;
      draft.runningGameId = null;
      draft.activeGameId = null;
      draft.resultsUntil = null;
      draft.resultDisplay = null;
      draft.roundParticipants = {};
      sendBarcodeGameChat(`Voting has started. Current pick: ${definition.title}. Vote in the Activities tab.`);
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
    const winnerDefinition = getGameDefinition(winner);
    if (!winnerDefinition) return false;
    withGameStore((draft) => {
      draft.selectedGameId = winner;
      draft.phase = 'joining';
      draft.joinEndsAt = now + JOIN_WINDOW_MS;
      draft.startsAt = null;
      draft.voteEndsAt = null;
      draft.roundParticipants = {};
      addRecentEvent(draft, {
        kind: 'gameJoining',
        gameId: winner,
        title: winnerDefinition.title,
      });
      sendBarcodeGameChat(`Voting ended. ${winnerDefinition.title} was selected with ${formatVoteSummary(draft.votes, winner)}. Scan a rover to join.`);
    });
    return true;
  }

  if (phase === 'joining' && store.joinEndsAt && now >= store.joinEndsAt) {
    withGameStore((draft) => {
      // Joining exists so a real rover has to physically opt into a round. If
      // nobody scans a rover in time, the selected game is discarded and the
      // system returns to idle instead of starting an empty round that cannot
      // award points to anyone.
      draft.phase = 'idle';
      draft.selectedGameId = null;
      draft.runningGameId = null;
      draft.activeGameId = null;
      draft.voteEndsAt = null;
      draft.joinEndsAt = null;
      draft.startsAt = null;
      draft.resultsUntil = null;
      draft.resultGameId = null;
      draft.resultDisplay = null;
      draft.votes = {};
      draft.roundParticipants = {};
      sendBarcodeGameChat('No rover joined in time. The selected barcode game was cancelled.');
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
      draft.joinEndsAt = null;
      draft.startsAt = null;
      draft.resultsUntil = null;
      draft.resultGameId = null;
      draft.resultDisplay = null;
      draft.votes = {};
      draft.roundParticipants = {};
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
      const participants = getRoundParticipants(draft);
      draft.phase = 'results';
      draft.resultGameId = activeGameId;
      draft.resultDisplay = display || publicState?.display || null;
      draft.resultsUntil = now + RESULTS_WINDOW_MS;
      draft.runningGameId = null;
      draft.activeGameId = null;
      draft.startsAt = null;
      draft.voteEndsAt = null;
      draft.joinEndsAt = null;
      draft.votes = {};
      sendGameEndChat(definition, {
        display: draft.resultDisplay,
        publicState,
        awards,
        participants,
      });
    }
  });
  return true;
}

function handleScan(scan) {
  const now = Number.isFinite(scan?.scannedAt) ? scan.scannedAt : Date.now();
  withGameStore((draft) => {
    updateGlobalCounters(draft, scan, now);
    const scannedRoverParticipant = recordRoverSighting(draft, scan, now);

    if (draft.phase === 'joining' && scannedRoverParticipant) {
      const selectedDefinition = getGameDefinition(draft.selectedGameId);
      const joinedParticipant = recordRoundParticipant(draft, scannedRoverParticipant, now);

      if (selectedDefinition && joinedParticipant) {
        // The first rover scan is the physical confirmation that a real player
        // is at the scanner and wants this voted game to start. The short
        // starting phase gives the room and chat display a predictable countdown
        // before game rules begin consuming object scans.
        draft.phase = 'starting';
        draft.startsAt = now + STARTING_WINDOW_MS;
        draft.joinEndsAt = null;
        addRecentEvent(draft, {
          kind: 'gameStarting',
          gameId: selectedDefinition.id,
          title: selectedDefinition.title,
          participant: joinedParticipant.nickname,
        });
      }
    } else if ((draft.phase === 'starting' || draft.phase === 'running') && scannedRoverParticipant) {
      // Rovers scanned during the countdown or action are counted as active participants too.
      // This supports the physical reality of the station: a rover may be seen
      // just before or during useful object scans, and that should be enough to
      // associate the driver with the current round.
      recordRoundParticipant(draft, scannedRoverParticipant, now);
    }

    const proximityParticipants = getProximityParticipants(draft, now);
    const participants = getRoundParticipants(draft);
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
        const finalParticipants = getRoundParticipants(draft);
        draft.phase = 'results';
        draft.resultGameId = activeGameId;
        draft.resultDisplay = display || publicState?.display || null;
        draft.resultsUntil = now + RESULTS_WINDOW_MS;
        draft.runningGameId = null;
        draft.activeGameId = null;
        draft.startsAt = null;
        draft.voteEndsAt = null;
        draft.joinEndsAt = null;
        draft.votes = {};
        sendGameEndChat(definition, {
          display: draft.resultDisplay,
          publicState,
          awards,
          participants: finalParticipants,
        });
      }
    }

    addRecentEvent(draft, {
      kind: 'scan',
      code: scan?.code || '',
      label: scan?.label || scan?.code || 'unknown',
      known: Boolean(scan?.known),
      type: scan?.type || null,
      participants: (participants.length ? participants : proximityParticipants)
        .map((participant) => participant.nickname || participant.roverId)
        .filter(Boolean),
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
  const participants = getRoundParticipants(store);
  const context = buildGameContext(store, { now, participants });
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
    participants,
    games: GAME_DEFINITIONS.map((game) => ({
      id: game.id,
      title: game.title,
      description: game.description,
      themeColor: getGameThemeColor(game),
      voteCount: voteCounts[game.id] || 0,
      active: game.id === store.runningGameId,
      selected: game.id === store.selectedGameId,
      actionLabel:
        store.phase === 'idle' || store.phase === 'results'
          ? 'Vote'
          : game.id === store.selectedGameId
            ? 'Selected'
            : 'Vote',
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
  const participants = getRoundParticipants(store);
  if (store.phase === 'running' && runningGame) {
    return {
      ...runningGame,
      themeColor: getGameThemeColor(runningDefinition),
      participants,
    };
  }
  if (store.phase === 'results') {
    const resultDefinition = getGameDefinition(store.resultGameId);
    return {
      id: store.resultGameId,
      title: resultDefinition?.title || 'Results',
      themeColor: getGameThemeColor(resultDefinition),
      status: 'results',
      participants,
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
      themeColor: getGameThemeColor(selectedDefinition),
      status: 'starting',
      participants,
      display: {
        title: selectedDefinition?.title || 'Starting',
        primary: selectedDefinition ? `${selectedDefinition.title} starts soon` : 'Game starts soon',
        secondary: 'Get ready',
        timer: store.startsAt ? { label: 'Starts in', endsAt: store.startsAt } : null,
        stats: [],
        results: [],
      },
    };
  }
  if (store.phase === 'joining') {
    const selectedTitle = selectedDefinition?.title || 'the selected game';
    return {
      id: store.selectedGameId,
      title: selectedDefinition?.title || 'Join game',
      themeColor: getGameThemeColor(selectedDefinition),
      status: 'joining',
      participants,
      display: {
        title: selectedDefinition?.title || 'Join game',
        primary: 'Scan your rover to start',
        secondary: `${selectedTitle} needs at least one rover`,
        timer: store.joinEndsAt ? { label: 'Join by', endsAt: store.joinEndsAt } : null,
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
      themeColor: getGameThemeColor(selectedDefinition),
      status: 'voting',
      participants,
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
    themeColor: null,
    status: 'idle',
    participants,
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
