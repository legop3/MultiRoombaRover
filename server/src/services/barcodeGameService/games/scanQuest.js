// Scan Quest Game
// Purpose: Implements the ordered object-scanning quest game.
// Scope: Keeps quest selection, scoring, and quest-specific display state out of
// the shared barcode game service.

const GAME_ID = 'scanQuest';
const QUEST_LENGTH_OPTIONS = [1, 2];
const REQUEST_TIMEOUT_MS = 90 * 1000;
const ROUND_DURATION_MS = 5 * 60 * 1000;
const POINTS_PER_STEP = 5;

function createInitialState() {
  return {
    currentQuest: null,
    status: 'idle',
    roundStartedAt: null,
    roundEndsAt: null,
    progressIndex: 0,
    scores: {},
    completedQuests: 0,
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
    completedQuests: Number.isFinite(rawState.completedQuests) ? Math.max(0, Math.floor(rawState.completedQuests)) : 0,
    stepStartedAt: Number.isFinite(rawState.stepStartedAt) ? rawState.stepStartedAt : null,
    recentEvents: Array.isArray(rawState.recentEvents) ? rawState.recentEvents.slice(-12) : [],
    lastMessage: typeof rawState.lastMessage === 'string' ? rawState.lastMessage : base.lastMessage,
  };
}

function pickQuest(objects = []) {
  const candidates = objects.filter((entry) => entry?.code && entry?.label);
  if (!candidates.length) return null;
  const length = QUEST_LENGTH_OPTIONS[Math.floor(Math.random() * QUEST_LENGTH_OPTIONS.length)];
  const steps = [];

  for (let idx = 0; idx < length; idx += 1) {
    // Reusing objects is allowed because physical rooms often start with only a
    // small number of labeled props. The game still stays readable because the
    // sequence is short and order-specific.
    const entry = candidates[Math.floor(Math.random() * candidates.length)];
    steps.push({
      code: entry.code,
      entityId: entry.entityId,
      label: entry.label,
    });
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    steps,
    createdAt: Date.now(),
  };
}

function formatQuestPrompt(state) {
  const quest = state.currentQuest;
  if (!quest?.steps?.length) return 'scan quest needs objects';
  const step = quest.steps[state.progressIndex] || quest.steps[0];
  if (quest.steps.length === 1) return `scan ${step.label}`;
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
  state.roundEndsAt = now + ROUND_DURATION_MS;
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

  // A timeout generates a fresh request instead of continuing a half-complete
  // sequence. If an item is physically unreachable or the barcode is damaged,
  // the room gets unstuck without punishing anyone or making the next prompt
  // depend on a failed previous step.
  const skippedStep = state.currentQuest.steps[state.progressIndex] || state.currentQuest.steps[0];
  addRecentEvent(state, {
    kind: 'timeout',
    label: skippedStep?.label || null,
  });
  state.currentQuest = pickQuest(context.objects || []);
  state.progressIndex = 0;
  state.stepStartedAt = state.currentQuest ? now : null;
  state.lastMessage = state.currentQuest ? `skipped. ${formatQuestPrompt(state)}` : 'scan quest needs objects';
  return state;
}

function handleScan(rawState, scan, context = {}) {
  const state = normalizeState(rawState);
  if (state.status !== 'running') return { state, awards: [] };
  ensureQuest(state, context);
  skipExpiredQuest(state, context);

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
  addRecentEvent(state, {
    kind: 'hit',
    label: scan.label,
  });

  if (state.progressIndex < state.currentQuest.steps.length) {
    state.lastMessage = formatQuestPrompt(state);
    return { state, awards: [] };
  }

  // A completed quest is worth more than a raw scan because it asks the driver
  // to find a specific object, stay in order, and finish within the per-request
  // window. Keeping this in a constant makes future game-balance passes obvious.
  const points = state.currentQuest.steps.length * POINTS_PER_STEP;
  state.completedQuests += 1;
  addScore(state, context.participants || [], points);
  addRecentEvent(state, {
    kind: 'complete',
    points,
    participants: (context.participants || []).map((participant) => participant.nickname || participant.roverId).filter(Boolean),
  });
  state.currentQuest = pickQuest(context.objects || []);
  state.progressIndex = 0;
  state.stepStartedAt = state.currentQuest ? context.now || Date.now() : null;
  state.lastMessage = state.currentQuest ? `scored ${points}. ${formatQuestPrompt(state)}` : `scored ${points}`;
  return {
    state,
    awards: buildAwards(context.participants || [], points, 'scan quest completed'),
  };
}

function tick(rawState, context = {}) {
  const state = normalizeState(rawState);
  const now = context.now || Date.now();
  if (state.status === 'running' && state.roundEndsAt && now >= state.roundEndsAt) {
    return {
      state: {
        ...state,
        status: 'ended',
        lastMessage: `finished ${state.completedQuests} quests`,
      },
      awards: [],
      done: true,
      display: getPublicState({ ...state, status: 'ended' }, context).display,
    };
  }
  ensureQuest(state, context);
  return skipExpiredQuest(state, context);
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
  const stepLabel = totalSteps > 1 ? `Step ${state.progressIndex + 1} of ${totalSteps}` : 'Find the object';
  return {
    id: GAME_ID,
    title: 'Scan quest',
    status: state.status === 'running' && state.currentQuest ? 'running' : state.status,
    headline: state.lastMessage || formatQuestPrompt(state),
    detail: state.currentQuest?.steps?.length
      ? state.currentQuest.steps.map((step) => step.label).join(' then ')
      : 'add object barcodes to the registry',
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
        { label: 'Completed', value: state.completedQuests },
        { label: 'Quest points', value: getTopScores(state)[0]?.points || 0 },
        { label: 'Round', value: state.status === 'ended' ? 'Done' : 'Running' },
      ],
      results: state.recentEvents.slice(0, 3).map((event) => ({
        label: event.kind === 'timeout' ? 'Skipped' : event.kind,
        value: event.label || event.points || '',
      })),
    },
    scores: getTopScores(state),
    completedQuests: state.completedQuests,
    recentEvents: state.recentEvents,
  };
}

module.exports = {
  id: GAME_ID,
  title: 'Scan quest',
  description: 'Scan one or two requested objects in order.',
  themeColor: { r: 34, g: 211, b: 238 },
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
