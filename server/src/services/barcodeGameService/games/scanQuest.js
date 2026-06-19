// Scan Quest Game
// Purpose: Implements the ordered object-scanning quest game.
// Scope: Keeps quest selection, scoring, and quest-specific display state out of
// the shared barcode game service.

const GAME_ID = 'scanQuest';
const QUEST_LENGTH = 5;
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
const POINTS_PER_STEP = 5;

function createInitialState() {
  return {
    currentQuest: null,
    status: 'idle',
    roundStartedAt: null,
    roundEndsAt: null,
    progressIndex: 0,
    scores: {},
    completedItems: 0,
    skippedItems: 0,
    stepStartedAt: null,
    recentEvents: [],
    lastMessage: 'vote to start scan quest',
  };
}

function normalizeState(rawState = {}) {
  const base = createInitialState();
  return {
    ...base,
    currentQuest: rawState.currentQuest && typeof rawState.currentQuest === 'object' ? rawState.currentQuest : null,
    status: rawState.status === 'running' || rawState.status === 'ended' ? rawState.status : 'idle',
    roundStartedAt: Number.isFinite(rawState.roundStartedAt) ? rawState.roundStartedAt : null,
    roundEndsAt: Number.isFinite(rawState.roundEndsAt) ? rawState.roundEndsAt : null,
    progressIndex: Number.isFinite(rawState.progressIndex) ? Math.max(0, Math.floor(rawState.progressIndex)) : 0,
    scores: rawState.scores && typeof rawState.scores === 'object' ? rawState.scores : {},
    completedItems: Number.isFinite(rawState.completedItems)
      ? Math.max(0, Math.floor(rawState.completedItems))
      : Number.isFinite(rawState.completedQuests)
        ? Math.max(0, Math.floor(rawState.completedQuests))
        : 0,
    skippedItems: Number.isFinite(rawState.skippedItems) ? Math.max(0, Math.floor(rawState.skippedItems)) : 0,
    stepStartedAt: Number.isFinite(rawState.stepStartedAt) ? rawState.stepStartedAt : null,
    recentEvents: Array.isArray(rawState.recentEvents) ? rawState.recentEvents.slice(-12) : [],
    lastMessage: typeof rawState.lastMessage === 'string' ? rawState.lastMessage : base.lastMessage,
  };
}

function pickQuest(objects = []) {
  const candidates = objects.filter((entry) => entry?.code && entry?.label);
  if (!candidates.length) return null;
  const shuffled = candidates
    .map((entry) => ({ entry, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ entry }) => entry);
  const selected = shuffled.slice(0, Math.min(QUEST_LENGTH, shuffled.length));

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // The entire route is chosen up front so players can see the ordered list
    // and plan rover movement. Items are unique when possible because repeated
    // entries make the list harder to reason about from the scanner display.
    steps: selected.map((entry) => ({
      code: entry.code,
      entityId: entry.entityId,
      label: entry.label,
    })),
    createdAt: Date.now(),
  };
}

function formatQuestPrompt(state) {
  const quest = state.currentQuest;
  if (!quest?.steps?.length) return 'scan quest needs objects';
  const step = quest.steps[state.progressIndex] || quest.steps[0];
  return `scan ${step.label} ${state.progressIndex + 1} of ${quest.steps.length}`;
}

function ensureQuest(state, context = {}) {
  if (state.currentQuest?.steps?.length) return state;
  const nextQuest = pickQuest(context.objects || []);
  state.currentQuest = nextQuest;
  state.progressIndex = 0;
  state.stepStartedAt = nextQuest ? context.now || Date.now() : null;
  state.lastMessage = nextQuest ? formatQuestPrompt(state) : 'scan quest needs objects';
  return state;
}

function addRecentEvent(state, event) {
  state.recentEvents = [
    {
      ...event,
      at: Date.now(),
    },
    ...(Array.isArray(state.recentEvents) ? state.recentEvents : []),
  ].slice(0, 12);
}

function addScore(state, participants = [], points) {
  participants.forEach((participant) => {
    const key = participant?.playerKey;
    if (!key) return;
    const previous = state.scores[key] || {};
    state.scores[key] = {
      playerKey: key,
      nickname: participant.nickname || previous.nickname || null,
      roverId: participant.roverId || previous.roverId || null,
      points: (Number.isFinite(previous.points) ? previous.points : 0) + points,
      lastScoredAt: Date.now(),
    };
  });
}

function buildAwards(participants = [], points, reason) {
  // Awards are returned to the shared barcode game service instead of mutating
  // the global player ledger here. That keeps this file responsible only for
  // scan quest rules while all cross-game points accounting stays centralized.
  return participants
    .filter((participant) => participant?.playerKey)
    .map((participant) => ({
      playerKey: participant.playerKey,
      nickname: participant.nickname || null,
      roverId: participant.roverId || null,
      cookieUserId: participant.cookieUserId || null,
      points,
      reason,
    }));
}

function start(_rawState, context = {}) {
  const now = context.now || Date.now();
  const state = createInitialState();
  state.status = 'running';
  state.roundStartedAt = now;
  state.roundEndsAt = null;
  ensureQuest(state, context);
  return state;
}

function activate(rawState, context = {}) {
  return start(rawState, context);
}

function skipExpiredQuest(state, context = {}) {
  const now = context.now || Date.now();
  if (!state.currentQuest?.steps?.length || !state.stepStartedAt) return state;
  if (now - state.stepStartedAt < REQUEST_TIMEOUT_MS) return state;

  // A timeout advances to the next item instead of generating a new quest. The
  // whole ordered list stays stable, but a bad or unreachable barcode cannot
  // trap the game forever on one physical object.
  const skippedStep = state.currentQuest.steps[state.progressIndex] || state.currentQuest.steps[0];
  addRecentEvent(state, {
    kind: 'timeout',
    label: skippedStep?.label || null,
  });
  state.skippedItems += 1;
  state.progressIndex += 1;

  if (state.progressIndex >= state.currentQuest.steps.length) {
    state.status = 'ended';
    state.stepStartedAt = null;
    state.lastMessage = `finished ${state.completedItems} items`;
    return state;
  }

  state.stepStartedAt = now;
  state.lastMessage = `skipped. ${formatQuestPrompt(state)}`;
  return state;
}

function handleScan(rawState, scan, context = {}) {
  const state = normalizeState(rawState);
  if (state.status !== 'running') return { state, awards: [] };
  ensureQuest(state, context);
  skipExpiredQuest(state, context);
  if (state.status === 'ended') {
    return {
      state,
      awards: [],
      done: true,
      display: getPublicState(state, context).display,
    };
  }

  if (!state.currentQuest?.steps?.length) return { state, awards: [] };
  if (!scan?.known || scan.type !== 'object') return { state, awards: [] };

  const expected = state.currentQuest.steps[state.progressIndex];
  const matched = Boolean(expected && scan.code === expected.code);

  if (!matched) {
    // Wrong scans do not erase the whole quest. That keeps the game forgiving
    // for rover driving mistakes while still making the ordered target clear on
    // the large scanner display.
    state.lastMessage = `try ${expected.label}`;
    addRecentEvent(state, {
      kind: 'miss',
      label: scan.label,
      expected: expected.label,
    });
    return { state, awards: [] };
  }

  state.progressIndex += 1;
  state.stepStartedAt = context.now || Date.now();
  state.completedItems += 1;
  addRecentEvent(state, {
    kind: 'hit',
    label: scan.label,
  });

  // A completed item is worth more than a raw scan because it asks the driver
  // to find a specific object, stay in order, and finish within the per-request
  // window. Keeping this in a constant makes future game-balance passes obvious.
  const points = POINTS_PER_STEP;
  addScore(state, context.participants || [], points);
  addRecentEvent(state, {
    kind: 'complete',
    points,
    participants: (context.participants || []).map((participant) => participant.nickname || participant.roverId).filter(Boolean),
  });

  if (state.progressIndex >= state.currentQuest.steps.length) {
    state.status = 'ended';
    state.stepStartedAt = null;
    state.lastMessage = `finished ${state.completedItems} items`;
    return {
      state,
      awards: buildAwards(context.participants || [], points, 'scan quest item completed'),
      done: true,
      display: getPublicState(state, context).display,
    };
  }

  state.lastMessage = `scored ${points}. ${formatQuestPrompt(state)}`;
  return {
    state,
    awards: buildAwards(context.participants || [], points, 'scan quest item completed'),
  };
}

function tick(rawState, context = {}) {
  const state = normalizeState(rawState);
  if (state.status !== 'running') return state;
  ensureQuest(state, context);
  const nextState = skipExpiredQuest(state, context);
  if (nextState.status === 'ended') {
    return {
      state: nextState,
      awards: [],
      done: true,
      display: getPublicState(nextState, context).display,
    };
  }
  return nextState;
}

function getTopScores(state) {
  return Object.values(state.scores || {})
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 5);
}

function getPublicState(rawState, context = {}) {
  const state = normalizeState(rawState);
  ensureQuest(state, context);
  skipExpiredQuest(state, context);
  const now = context.now || Date.now();
  const remainingMs = state.stepStartedAt
    ? Math.max(0, REQUEST_TIMEOUT_MS - (now - state.stepStartedAt))
    : 0;
  const currentStep = state.currentQuest?.steps?.[state.progressIndex] || null;
  const totalSteps = state.currentQuest?.steps?.length || 0;
  const stepLabel = totalSteps ? `Item ${Math.min(state.progressIndex + 1, totalSteps)} of ${totalSteps}` : 'Find the object';
  const orderedList = state.currentQuest?.steps?.length
    ? state.currentQuest.steps.map((step, idx) => `${idx + 1}. ${step.label}`).join(' -> ')
    : 'add object barcodes to the registry';
  return {
    id: GAME_ID,
    title: 'Scan quest',
    status: state.status === 'running' && state.currentQuest ? 'running' : state.status,
    headline: state.lastMessage || formatQuestPrompt(state),
    detail: orderedList,
    progress: {
      current: state.progressIndex,
      total: state.currentQuest?.steps?.length || 0,
    },
    remainingMs,
    actionLabel: 'Start quest',
    display: {
      // The display payload is intentionally structured instead of HTML or
      // React component names. Games describe what should be shown, while each
      // client surface decides how large or compact that information should be.
      title: 'Scan quest',
      primary: currentStep ? `Scan ${currentStep.label}` : 'Add object barcodes',
      secondary: currentStep ? stepLabel : 'The registry needs at least one object',
      timer: state.stepStartedAt
        ? {
            label: 'Time left',
            endsAt: state.stepStartedAt + REQUEST_TIMEOUT_MS,
          }
        : null,
      stats: [
        { label: 'Completed', value: state.completedItems },
        { label: 'Skipped', value: state.skippedItems },
        { label: 'Quest points', value: getTopScores(state)[0]?.points || 0 },
      ],
      results: state.recentEvents.slice(0, 3).map((event) => ({
        label: event.kind === 'timeout' ? 'Skipped' : event.kind,
        value: event.label || event.points || '',
      })),
    },
    scores: getTopScores(state),
    completedItems: state.completedItems,
    skippedItems: state.skippedItems,
    recentEvents: state.recentEvents,
  };
}

module.exports = {
  id: GAME_ID,
  title: 'Scan quest',
  description: 'Scan requested objects for points.',
  themeColor: { r: 255, g: 150, b: 252 },
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
