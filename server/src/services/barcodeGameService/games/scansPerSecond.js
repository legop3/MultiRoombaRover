// Scans Per Second Game
// Purpose: Implements a timed five-minute scan-rate challenge.
// Scope: Counts every scan event for this game, including unknown and invalid
// codes, while preserving persistent round results and the world record.

const GAME_ID = 'scansPerSecond';
const ROUND_DURATION_MS = 5 * 60 * 1000;
const RESULT_IDLE_MS = 60 * 1000;

function createInitialState() {
  return {
    status: 'idle',
    roundId: null,
    startedAt: null,
    endsAt: null,
    scans: [],
    bestRate: 0,
    bestRateAt: null,
    finalResult: null,
    worldRecord: null,
    recentRounds: [],
    participantCounts: {},
    endedAt: null,
    lastMessage: 'vote to start scans per second',
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
    scans: Array.isArray(rawState.scans) ? rawState.scans.filter((entry) => Number.isFinite(entry?.at)) : [],
    bestRate: Number.isFinite(rawState.bestRate) ? Math.max(0, rawState.bestRate) : 0,
    bestRateAt: Number.isFinite(rawState.bestRateAt) ? rawState.bestRateAt : null,
    finalResult: rawState.finalResult && typeof rawState.finalResult === 'object' ? rawState.finalResult : null,
    worldRecord: rawState.worldRecord && typeof rawState.worldRecord === 'object' ? rawState.worldRecord : null,
    recentRounds: Array.isArray(rawState.recentRounds) ? rawState.recentRounds.slice(-10) : [],
    participantCounts:
      rawState.participantCounts && typeof rawState.participantCounts === 'object' ? rawState.participantCounts : {},
    endedAt: Number.isFinite(rawState.endedAt) ? rawState.endedAt : null,
    lastMessage: typeof rawState.lastMessage === 'string' ? rawState.lastMessage : base.lastMessage,
  };
}

function calculateRate(scanCount, startedAt, endedAt) {
  if (!scanCount || !startedAt || !endedAt || endedAt <= startedAt) return 0;
  return scanCount / ((endedAt - startedAt) / 1000);
}

function buildResult(state, endedAt = Date.now()) {
  const scanCount = state.scans.length;
  const finalRate = calculateRate(scanCount, state.startedAt, endedAt);
  const bestRate = Math.max(Number(state.bestRate || 0), finalRate);
  return {
    roundId: state.roundId,
    scanCount,
    durationMs: Math.max(0, endedAt - (state.startedAt || endedAt)),
    scansPerSecond: Number(bestRate.toFixed(3)),
    finalScansPerSecond: Number(finalRate.toFixed(3)),
    startedAt: state.startedAt,
    endedAt,
    participants: Object.values(state.participantCounts || {}).sort((a, b) => (b.scanCount || 0) - (a.scanCount || 0)),
  };
}

function finishRound(state, endedAt = Date.now()) {
  if (state.status !== 'running') return state;
  const result = buildResult(state, endedAt);
  const previousRecord = state.worldRecord;
  const isWorldRecord = !previousRecord || result.scansPerSecond > (previousRecord.scansPerSecond || 0);

  state.status = 'ended';
  state.endedAt = endedAt;
  state.finalResult = {
    ...result,
    isWorldRecord,
  };
  state.worldRecord = isWorldRecord ? result : previousRecord;
  state.recentRounds = [state.finalResult, ...(state.recentRounds || [])].slice(0, 10);
  state.lastMessage = isWorldRecord
    ? `new record ${result.scansPerSecond} scans per second`
    : `finished ${result.scansPerSecond} scans per second`;
  return state;
}

function buildAwards(result, state) {
  if (!result?.participants?.length || !result.scanCount) return [];
  const basePoints = Math.max(1, Math.round(result.scansPerSecond * 10));
  return result.participants
    .filter((participant) => participant?.playerKey)
    .map((participant) => {
      const share = result.scanCount > 0 ? participant.scanCount / result.scanCount : 0;
      return {
        playerKey: participant.playerKey,
        nickname: participant.nickname || null,
        roverId: participant.roverId || null,
        points: Math.max(1, Math.round(basePoints * share)),
        reason: 'scans per second round',
        gameMeta: {
          scansPerSecond: result.scansPerSecond,
          roundId: state.roundId,
        },
      };
    });
}

function startRound(rawState, now = Date.now()) {
  const previous = normalizeState(rawState);
  return {
    ...previous,
    status: 'running',
    roundId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: now,
    endsAt: now + ROUND_DURATION_MS,
    scans: [],
    bestRate: 0,
    bestRateAt: null,
    finalResult: null,
    participantCounts: {},
    endedAt: null,
    lastMessage: 'scan anything',
  };
}

function start(rawState, context = {}) {
  const state = normalizeState(rawState);
  const now = context.now || Date.now();
  // Starting a game should always produce a fresh playable round. The global
  // service owns when a round starts, so this module does not need to preserve a
  // prior ended/running state across lifecycle transitions.
  return startRound(state, now);
}

function activate(rawState, context = {}) {
  return start(rawState, context);
}

function reset(rawState, context = {}) {
  const state = normalizeState(rawState);
  return startRound(state, context.now || Date.now());
}

function addParticipants(state, participants = []) {
  participants.forEach((participant) => {
    const key = participant?.playerKey;
    if (!key) return;
    const previous = state.participantCounts[key] || {};
    state.participantCounts[key] = {
      playerKey: key,
      nickname: participant.nickname || previous.nickname || null,
      roverId: participant.roverId || previous.roverId || null,
      scanCount: (Number.isFinite(previous.scanCount) ? previous.scanCount : 0) + 1,
      lastSeenAt: Date.now(),
    };
  });
}

function handleScan(rawState, scan, context = {}) {
  const now = context.now || Date.now();
  let state = normalizeState(rawState);
  let awards = [];
  if (state.status === 'running' && state.endsAt && now >= state.endsAt) {
    state = finishRound(state, state.endsAt);
    awards = buildAwards(state.finalResult, state);
  }
  if (state.status !== 'running') {
    return {
      state,
      awards,
      done: Boolean(awards.length),
      display: awards.length ? getPublicState(state, { ...context, now }).display : null,
    };
  }

  // This game deliberately counts every submitted scan, including unknown and
  // invalid barcodes, because the challenge is about physically getting scans
  // through the station rather than finding specific registry entries.
  state.scans = [
    ...(state.scans || []),
    {
      code: scan?.code || '',
      known: Boolean(scan?.known),
      at: now,
    },
  ];
  addParticipants(state, context.participants || []);

  if (state.endsAt && now >= state.endsAt) {
    state = finishRound(state, state.endsAt);
    return {
      state,
      awards: buildAwards(state.finalResult, state),
      done: true,
      display: getPublicState(state, { ...context, now }).display,
    };
  }

  const currentRate = calculateRate(state.scans.length, state.startedAt, now);
  if (currentRate > (state.bestRate || 0)) {
    state.bestRate = Number(currentRate.toFixed(3));
    state.bestRateAt = now;
  }
  state.lastMessage = `${currentRate.toFixed(2)} scans per second`;
  return { state, awards: [] };
}

function tick(rawState, context = {}) {
  const now = context.now || Date.now();
  const state = normalizeState(rawState);
  if (state.status === 'running' && state.endsAt && now >= state.endsAt) {
    const finished = finishRound(state, state.endsAt);
    return {
      state: finished,
      awards: buildAwards(finished.finalResult, finished),
      done: true,
      display: getPublicState(finished, { ...context, now }).display,
    };
  }
  if (state.status === 'ended' && state.endedAt && now - state.endedAt >= RESULT_IDLE_MS) {
    // Timed result screens are useful for celebration, but the game should not
    // remain permanently stuck in a completed state. After a short display
    // window the module returns itself to idle, preserving records and history.
    return {
      ...state,
      status: 'idle',
      roundId: null,
      startedAt: null,
      endsAt: null,
      scans: [],
      bestRate: 0,
      bestRateAt: null,
      participantCounts: {},
      lastMessage: 'vote to start scans per second',
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

  const elapsedEnd = state.status === 'running' ? now : state.finalResult?.endedAt || now;
  const currentRate = state.status === 'running'
    ? calculateRate(state.scans.length, state.startedAt, elapsedEnd)
    : state.finalResult?.scansPerSecond || 0;
  const remainingMs = state.status === 'running' ? Math.max(0, (state.endsAt || now) - now) : 0;
  const worldRecordText = state.worldRecord
    ? `${Number(state.worldRecord.scansPerSecond || 0).toFixed(2)} scans per second`
    : 'none yet';
  const bestRate = Math.max(Number(state.bestRate || 0), state.finalResult?.scansPerSecond || 0);
  const primary = state.status === 'running'
    ? `${Number(bestRate).toFixed(2)} scans per second`
    : state.finalResult
      ? `${Number(state.finalResult.scansPerSecond || 0).toFixed(2)} scans per second`
      : 'Scan anything';

  return {
    id: GAME_ID,
    title: 'Scans per second',
    status: state.status,
    headline: state.lastMessage,
    detail: state.status === 'running'
      ? `${state.scans.length} scans, ${Math.ceil(remainingMs / 1000)} seconds left`
      : state.finalResult
        ? `${state.finalResult.scanCount} scans in last round`
        : 'five minute scan challenge',
    scanCount: state.scans.length,
    scansPerSecond: Number(currentRate.toFixed(3)),
    bestRate: Number(bestRate.toFixed(3)),
    remainingMs,
    finalResult: state.finalResult,
    worldRecord: state.worldRecord,
    participants: Object.values(state.participantCounts || {}).sort((a, b) => (b.scanCount || 0) - (a.scanCount || 0)),
    recentRounds: state.recentRounds,
    actionLabel: state.status === 'running' ? 'Running' : 'Start round',
    display: {
      // This display description lets the scanner page and the driver panel
      // render the same game state at different scales without hardcoding
      // scans-per-second-specific UI branches in shared React components.
      title: 'Scans per second',
      primary,
      secondary: state.status === 'running'
        ? `${state.scans.length} scans counted`
        : state.finalResult
          ? `${state.finalResult.scanCount} scans in the last round`
          : 'Five minute scan challenge',
      timer: state.status === 'running' && state.endsAt
        ? {
            label: 'Time left',
            endsAt: state.endsAt,
          }
        : null,
      stats: [
        { label: 'Scans', value: state.scans.length },
        { label: 'Live rate', value: Number(currentRate).toFixed(2) },
        { label: 'World record', value: worldRecordText },
      ],
      results: state.recentRounds.slice(0, 3).map((round) => ({
        label: 'Round',
        value: `${Number(round.scansPerSecond || 0).toFixed(2)} scans per second`,
      })),
    },
  };
}

module.exports = {
  id: GAME_ID,
  title: 'Scans per second',
  description: 'Count every scan for five minutes and save the world record.',
  createInitialState,
  normalizeState,
  activate,
  start,
  reset,
  handleScan,
  tick,
  onActivated: activate,
  onScan: (state, scan, context) => handleScan(state, scan, context).state,
  onTick: tick,
  getPublicState,
};
