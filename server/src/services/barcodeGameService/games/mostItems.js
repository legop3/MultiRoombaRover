// Most Items Game
// Purpose: Runs a timed object-collection challenge where the room tries to
// scan as many different known objects as possible.
// Scope: Tracks only game-local round state and returns point awards; the
// shared barcode game service owns voting, player identity, persistence, and
// global leaderboard updates.

const GAME_ID = 'mostItems';
const ROUND_DURATION_MS = 5 * 60 * 1000;
const POINTS_PER_UNIQUE_ITEM = 3;
const MAX_POINTS_PER_PLAYER = 30;

function createInitialState() {
  return {
    status: 'idle',
    roundId: null,
    startedAt: null,
    endsAt: null,
    seenObjects: {},
    totalObjectScans: 0,
    duplicateObjectScans: 0,
    ignoredScans: 0,
    participantCounts: {},
    finalResult: null,
    worldRecord: null,
    recentRounds: [],
    lastObjectLabel: null,
    lastMessage: 'vote to start most items',
  };
}

function normalizeState(rawState = {}) {
  const base = createInitialState();
  return {
    ...base,
    status: rawState.status === 'running' || rawState.status === 'ended' ? rawState.status : 'idle',
    roundId: typeof rawState.roundId === 'string' ? rawState.roundId : null,
    startedAt: Number.isFinite(rawState.startedAt) ? rawState.startedAt : null,
    endsAt: Number.isFinite(rawState.endsAt) ? rawState.endsAt : null,
    seenObjects: rawState.seenObjects && typeof rawState.seenObjects === 'object' ? rawState.seenObjects : {},
    totalObjectScans: Number.isFinite(rawState.totalObjectScans) ? Math.max(0, Math.floor(rawState.totalObjectScans)) : 0,
    duplicateObjectScans: Number.isFinite(rawState.duplicateObjectScans)
      ? Math.max(0, Math.floor(rawState.duplicateObjectScans))
      : 0,
    ignoredScans: Number.isFinite(rawState.ignoredScans) ? Math.max(0, Math.floor(rawState.ignoredScans)) : 0,
    participantCounts:
      rawState.participantCounts && typeof rawState.participantCounts === 'object' ? rawState.participantCounts : {},
    finalResult: rawState.finalResult && typeof rawState.finalResult === 'object' ? rawState.finalResult : null,
    worldRecord: rawState.worldRecord && typeof rawState.worldRecord === 'object' ? rawState.worldRecord : null,
    recentRounds: Array.isArray(rawState.recentRounds) ? rawState.recentRounds.slice(-10) : [],
    lastObjectLabel: typeof rawState.lastObjectLabel === 'string' ? rawState.lastObjectLabel : null,
    lastMessage: typeof rawState.lastMessage === 'string' ? rawState.lastMessage : base.lastMessage,
  };
}

function getObjectKey(scan = {}) {
  // entityId is preferred because it is the actual object identity. The code is
  // kept as a fallback so a registry entry with a missing/odd entity value still
  // behaves deterministically instead of collapsing into one anonymous object.
  return String(scan.entityId || scan.code || '').trim();
}

function getUniqueCount(state) {
  return Object.keys(state.seenObjects || {}).length;
}

function getParticipantList(state) {
  return Object.values(state.participantCounts || {})
    .sort((a, b) => (b.uniqueItems || 0) - (a.uniqueItems || 0))
    .map((participant) => ({
      playerKey: participant.playerKey || null,
      nickname: participant.nickname || participant.roverId || 'unknown player',
      roverId: participant.roverId || null,
      uniqueItems: Number.isFinite(participant.uniqueItems) ? participant.uniqueItems : 0,
      lastSeenAt: Number.isFinite(participant.lastSeenAt) ? participant.lastSeenAt : null,
    }));
}

function addParticipantCredit(state, participants = [], now, uniqueItemScanned) {
  participants.forEach((participant) => {
    const key = participant?.playerKey;
    if (!key) return;
    const previous = state.participantCounts[key] || {};

    // This is a cooperative game, but late joiners should not get retroactive
    // credit for objects scanned before they joined. Each unique item credits
    // the identity-backed participants who were active at scan time.
    state.participantCounts[key] = {
      playerKey: key,
      nickname: participant.nickname || previous.nickname || null,
      roverId: participant.roverId || previous.roverId || null,
      uniqueItems: (Number.isFinite(previous.uniqueItems) ? previous.uniqueItems : 0) + (uniqueItemScanned ? 1 : 0),
      lastSeenAt: now,
    };
  });
}

function buildResult(state, endedAt = Date.now()) {
  const participants = getParticipantList(state);
  const uniqueItems = getUniqueCount(state);
  return {
    roundId: state.roundId,
    uniqueItems,
    totalObjectScans: state.totalObjectScans,
    duplicateObjectScans: state.duplicateObjectScans,
    ignoredScans: state.ignoredScans,
    durationMs: Math.max(0, endedAt - (state.startedAt || endedAt)),
    startedAt: state.startedAt,
    endedAt,
    participants,
    objects: Object.values(state.seenObjects || {}).sort((a, b) => (a.firstScannedAt || 0) - (b.firstScannedAt || 0)),
  };
}

function finishRound(state, endedAt = Date.now()) {
  if (state.status !== 'running') return state;
  const result = buildResult(state, endedAt);
  const previousRecord = state.worldRecord;
  const isWorldRecord = !previousRecord || result.uniqueItems > (previousRecord.uniqueItems || 0);

  state.status = 'ended';
  state.finalResult = {
    ...result,
    isWorldRecord,
  };
  state.worldRecord = isWorldRecord ? result : previousRecord;
  state.recentRounds = [state.finalResult, ...(state.recentRounds || [])].slice(0, 10);
  state.lastMessage = isWorldRecord
    ? `new record ${result.uniqueItems} items`
    : `finished ${result.uniqueItems} items`;
  return state;
}

function buildAwards(result) {
  if (!result?.participants?.length || !result.uniqueItems) return [];

  return result.participants
    .filter((participant) => participant?.playerKey && participant.uniqueItems > 0)
    .map((participant) => {
      const points = Math.min(MAX_POINTS_PER_PLAYER, participant.uniqueItems * POINTS_PER_UNIQUE_ITEM);
      return {
        playerKey: participant.playerKey,
        nickname: participant.nickname || null,
        roverId: participant.roverId || null,
        points,
        reason: 'most items round',
        gameMeta: {
          uniqueItems: participant.uniqueItems,
          roundId: result.roundId,
        },
      };
    });
}

function start(rawState, context = {}) {
  const previous = normalizeState(rawState);
  const now = context.now || Date.now();
  return {
    ...previous,
    status: 'running',
    roundId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: now,
    endsAt: now + ROUND_DURATION_MS,
    seenObjects: {},
    totalObjectScans: 0,
    duplicateObjectScans: 0,
    ignoredScans: 0,
    participantCounts: {},
    finalResult: null,
    lastObjectLabel: null,
    lastMessage: 'scan different objects',
  };
}

function activate(rawState, context = {}) {
  return start(rawState, context);
}

function handleScan(rawState, scan, context = {}) {
  const now = context.now || Date.now();
  let state = normalizeState(rawState);
  if (state.status === 'running' && state.endsAt && now >= state.endsAt) {
    state = finishRound(state, state.endsAt);
    return {
      state,
      awards: buildAwards(state.finalResult),
      done: true,
      display: getPublicState(state, { ...context, now }).display,
    };
  }
  if (state.status !== 'running') return { state, awards: [] };

  if (!scan?.known || scan.type !== 'object') {
    // Rover and unknown scans still matter to the shared coordinator for
    // participant tracking, but this game only scores known physical objects.
    state.ignoredScans += 1;
    state.lastMessage = 'find object barcodes';
    return { state, awards: [] };
  }

  const objectKey = getObjectKey(scan);
  if (!objectKey) {
    state.ignoredScans += 1;
    state.lastMessage = 'object needs an id';
    return { state, awards: [] };
  }

  state.totalObjectScans += 1;
  const previousObject = state.seenObjects[objectKey] || null;
  const uniqueItemScanned = !previousObject;

  if (uniqueItemScanned) {
    state.seenObjects[objectKey] = {
      code: scan.code || null,
      entityId: scan.entityId || objectKey,
      label: scan.label || objectKey,
      firstScannedAt: now,
    };
    state.lastObjectLabel = scan.label || objectKey;
    state.lastMessage = `${getUniqueCount(state)} items`;
  } else {
    state.duplicateObjectScans += 1;
    state.lastObjectLabel = previousObject.label || scan.label || objectKey;
    state.lastMessage = `${state.lastObjectLabel} already counted`;
  }

  addParticipantCredit(state, context.participants || [], now, uniqueItemScanned);
  return { state, awards: [] };
}

function tick(rawState, context = {}) {
  const now = context.now || Date.now();
  const state = normalizeState(rawState);
  if (state.status === 'running' && state.endsAt && now >= state.endsAt) {
    const finished = finishRound(state, state.endsAt);
    return {
      state: finished,
      awards: buildAwards(finished.finalResult),
      done: true,
      display: getPublicState(finished, { ...context, now }).display,
    };
  }
  return state;
}

function getPublicState(rawState, context = {}) {
  let state = normalizeState(rawState);
  const now = context.now || Date.now();
  if (state.status === 'running' && state.endsAt && now >= state.endsAt) {
    state = finishRound(state, state.endsAt);
  }

  const uniqueItems = state.status === 'ended' && state.finalResult
    ? state.finalResult.uniqueItems
    : getUniqueCount(state);
  const remainingMs = state.status === 'running' ? Math.max(0, (state.endsAt || now) - now) : 0;
  const worldRecordText = state.worldRecord ? `${state.worldRecord.uniqueItems || 0} items` : 'none yet';
  const participantResults = state.status === 'ended' && state.finalResult
    ? state.finalResult.participants
    : getParticipantList(state);

  return {
    id: GAME_ID,
    title: 'Most items',
    status: state.status,
    headline: state.lastMessage,
    detail: state.status === 'running'
      ? `${uniqueItems} unique items, ${Math.ceil(remainingMs / 1000)} seconds left`
      : state.finalResult
        ? `${state.finalResult.uniqueItems} unique items in last round`
        : 'scan different known objects',
    uniqueItems,
    totalObjectScans: state.totalObjectScans,
    duplicateObjectScans: state.duplicateObjectScans,
    remainingMs,
    finalResult: state.finalResult,
    worldRecord: state.worldRecord,
    scores: participantResults
      .map((participant) => ({
        playerKey: participant.playerKey,
        nickname: participant.nickname,
        roverId: participant.roverId,
        points: Math.min(MAX_POINTS_PER_PLAYER, (participant.uniqueItems || 0) * POINTS_PER_UNIQUE_ITEM),
      }))
      .filter((entry) => entry.points > 0),
    participants: participantResults,
    recentRounds: state.recentRounds,
    actionLabel: state.status === 'running' ? 'Running' : 'Start round',
    display: {
      // The display contract is deliberately generic. The web UI renders these
      // fields for every game, so the game describes object-count progress
      // without requiring custom React components.
      title: 'Most items',
      primary: `${uniqueItems} ${uniqueItems === 1 ? 'item' : 'items'}`,
      secondary: state.lastObjectLabel ? `Last: ${state.lastObjectLabel}` : 'Scan different known objects',
      timer: state.status === 'running' && state.endsAt
        ? {
            label: 'Time left',
            endsAt: state.endsAt,
          }
        : null,
      stats: [
        { label: 'Unique items', value: uniqueItems },
        { label: 'Object scans', value: state.totalObjectScans },
        { label: 'World record', value: worldRecordText },
      ],
      results: Object.values(state.seenObjects || {}).slice(-3).map((object) => ({
        label: 'Item',
        value: object.label || object.entityId || object.code,
      })),
    },
  };
}

module.exports = {
  id: GAME_ID,
  title: 'Most items',
  description: 'Scan as many different known objects as possible.',
  themeColor: { r: 255, g: 145, b: 71 },
  createInitialState,
  normalizeState,
  activate,
  start,
  handleScan,
  tick,
  onActivated: activate,
  onScan: (state, scan, context) => handleScan(state, scan, context).state,
  onTick: tick,
  getPublicState,
};
