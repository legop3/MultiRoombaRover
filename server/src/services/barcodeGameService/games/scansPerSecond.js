// Scans Per Second Game
// Purpose: Implements a timed five-minute scan-rate challenge.
// Scope: Counts every scan event for this game, including unknown and invalid
// codes, while preserving persistent round results and the world record.

const GAME_ID = 'scansPerSecond';
const ROUND_DURATION_MS = 5 * 60 * 1000;

function createInitialState() {
  return {
    status: 'idle',
    roundId: null,
    startedAt: null,
    endsAt: null,
    scans: [],
    finalResult: null,
    worldRecord: null,
    recentRounds: [],
    participantCounts: {},
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
    finalResult: rawState.finalResult && typeof rawState.finalResult === 'object' ? rawState.finalResult : null,
    worldRecord: rawState.worldRecord && typeof rawState.worldRecord === 'object' ? rawState.worldRecord : null,
    recentRounds: Array.isArray(rawState.recentRounds) ? rawState.recentRounds.slice(-10) : [],
    participantCounts:
      rawState.participantCounts && typeof rawState.participantCounts === 'object' ? rawState.participantCounts : {},
    lastMessage: typeof rawState.lastMessage === 'string' ? rawState.lastMessage : base.lastMessage,
  };
}

function calculateRate(scanCount, startedAt, endedAt) {
  if (!scanCount || !startedAt || !endedAt || endedAt <= startedAt) return 0;
  return scanCount / ((endedAt - startedAt) / 1000);
}

function buildResult(state, endedAt = Date.now()) {
  const scanCount = state.scans.length;
  const rate = calculateRate(scanCount, state.startedAt, endedAt);
  return {
    roundId: state.roundId,
    scanCount,
    durationMs: Math.max(0, endedAt - (state.startedAt || endedAt)),
    scansPerSecond: Number(rate.toFixed(3)),
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

function startRound(rawState, now = Date.now()) {
  const previous = normalizeState(rawState);
  return {
    ...previous,
    status: 'running',
    roundId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: now,
    endsAt: now + ROUND_DURATION_MS,
    scans: [],
    finalResult: null,
    participantCounts: {},
    lastMessage: 'scan anything',
  };
}

function onActivated(rawState, context = {}) {
  const state = normalizeState(rawState);
  const now = context.now || Date.now();
  // Voting for an ended or idle challenge starts a fresh five-minute round. If
  // the round is already running, activation is a no-op so vote churn does not
  // accidentally reset an active challenge.
  return state.status === 'running' ? state : startRound(state, now);
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

function onScan(rawState, scan, context = {}) {
  const now = context.now || Date.now();
  let state = normalizeState(rawState);
  if (state.status === 'running' && state.endsAt && now >= state.endsAt) {
    state = finishRound(state, state.endsAt);
  }
  if (state.status !== 'running') return state;

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
    return finishRound(state, state.endsAt);
  }

  const currentRate = calculateRate(state.scans.length, state.startedAt, now);
  state.lastMessage = `${currentRate.toFixed(2)} scans per second`;
  return state;
}

function onTick(rawState, context = {}) {
  const now = context.now || Date.now();
  const state = normalizeState(rawState);
  if (state.status === 'running' && state.endsAt && now >= state.endsAt) {
    return finishRound(state, state.endsAt);
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
    remainingMs,
    finalResult: state.finalResult,
    worldRecord: state.worldRecord,
    participants: Object.values(state.participantCounts || {}).sort((a, b) => (b.scanCount || 0) - (a.scanCount || 0)),
    recentRounds: state.recentRounds,
  };
}

module.exports = {
  id: GAME_ID,
  title: 'Scans per second',
  description: 'Count every scan for five minutes and save the world record.',
  createInitialState,
  normalizeState,
  onActivated,
  onScan,
  onTick,
  getPublicState,
};
