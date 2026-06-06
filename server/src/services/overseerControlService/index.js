const fsp = require('fs/promises');
const { Ollama } = require('ollama');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('overseerControl');
const { loadConfig } = require('../../helpers/configLoader');
const { getRole, roleEvents } = require('../roleService');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { verificationEvents } = require('../verificationService');
const homeAssistantService = require('../homeAssistantService');
const neatoService = require('../neatoService');
const liftService = require('../liftService');
const buttonBoxService = require('../buttonBoxService');
const { getState: getHomeAssistantState, homeAssistantEvents } = homeAssistantService;
const { getState: getNeatoState, neatoEvents } = neatoService;
const { getState: getLiftState, liftEvents } = liftService;
const roverManager = require('../roverManager');
const { getRecentMessages, sendSystemMessage } = require('../chatService');
const { subscribe } = require('../eventBus');
const {
  PROMPT_PATH,
  DEFAULT_NAME,
  DEFAULT_GATE_INTERVAL_MS,
  MAX_RUN_HISTORY,
  MAX_CHAT_CONTEXT,
  MAX_BOT_CONTEXT,
  normalizeMs,
} = require('./constants');
const { isAdminRole, buildAdminState, buildFailureInfo } = require('./runtimeHelpers');
const { toStateUpdate, buildToolState, buildConversation, buildModelMessages } = require('./contextBuilder');
const { buildOllamaTools, executeToolAction } = require('./tools');
const { loadMemory, saveMemory, createDefaultMemory, summarizeMemory } = require('./memoryStore');

const config = loadConfig();
const overseerConfig = config.overseerControl || {};
const enabled = Boolean(overseerConfig.enabled);
const observeOnly = overseerConfig.observeOnly !== false;
const name = String(overseerConfig.name || DEFAULT_NAME).trim() || DEFAULT_NAME;
const model = String(overseerConfig.model || '').trim();
const ollamaUrl = String(overseerConfig.ollamaUrl || overseerConfig.ollamaServer || '').trim();
const gateIntervalMs = normalizeMs(Number(overseerConfig.gateIntervalMs), DEFAULT_GATE_INTERVAL_MS);
const postToolsOnlyMessages = Boolean(overseerConfig.postToolsOnlyMessages);
const tiebreakerEnable = Boolean(overseerConfig.tiebreakerEnable);
const runWhileNoPeopleOnline = Boolean(overseerConfig.runWhileNoPeopleOnline);
const profileImageUrl = String(overseerConfig.profileImageUrl || '').trim() || null;
const ollamaClient = ollamaUrl ? new Ollama({ host: ollamaUrl }) : null;

const runtime = {
  timer: null,
  inFlight: false,
  tickCount: 0,
  generationCount: 0,
  generationTotalMs: 0,
  runHistory: [],
  liveToolCalls: [],
  memoryStore: loadMemory(),
  contextResetAt: Date.now(),
};

let status = {
  enabled,
  observeOnly,
  name,
  model,
  ollamaUrl,
  promptPath: PROMPT_PATH,
  gateIntervalMs,
  postToolsOnlyMessages,
  tiebreakerEnable,
  runWhileNoPeopleOnline,
  running: false,
  inFlight: false,
  phase: 'idle',
  phaseAt: Date.now(),
  tickCount: 0,
  currentRunId: null,
  nextRunAt: null,
  lastTickAt: null,
  lastTriggerReason: null,
  lastSystemPrompt: null,
  lastStateUpdate: null,
  lastTranscript: null,
  lastAvailableTools: null,
  lastBlockedTools: null,
  lastModelMessages: null,
  lastModelInputAt: null,
  lastModelOutputAt: null,
  lastModelRawOutput: null,
  lastDecision: null,
  lastChatDraft: null,
  lastRequestedActions: null,
  lastActionResults: null,
  lastLiveToolCalls: null,
  lastOutcome: null,
  lastReason: null,
  voteStatus: null,
  lastError: null,
  lastErrorDetails: null,
  lastFailedAt: null,
  lastGenerationMs: null,
  avgGenerationMs: null,
  generationCount: 0,
  updatedAt: Date.now(),
};

function buildVoteStatus() {
  const sockets = Array.from(io.sockets.sockets.values());
  let yesCount = 0;
  let noCount = 0;
  const votesByIdentity = new Map();
  const isEligibleVoter = (socket) => getRole(socket) !== 'spectator';

  sockets.forEach((socket) => {
    if (!isEligibleVoter(socket)) return;
    const identityKey = String(socket?.data?.cookieUserId || '').trim() || `socket:${socket.id}`;
    const pref = typeof socket?.data?.overseerEnabled === 'boolean' ? socket.data.overseerEnabled : true;
    const prev = votesByIdentity.get(identityKey);
    if (typeof prev === 'boolean') {
      // If one tab says "no", treat that user as "no" to avoid accidental override by stale tabs.
      votesByIdentity.set(identityKey, prev && pref);
      return;
    }
    votesByIdentity.set(identityKey, pref);
  });

  votesByIdentity.forEach((pref) => {
    if (pref) yesCount += 1;
    else noCount += 1;
  });

  const eligibleCount = votesByIdentity.size;
  const onlineCount = yesCount + noCount;
  let gatePassed = false;
  if (eligibleCount === 0) {
    gatePassed = runWhileNoPeopleOnline;
  } else if (yesCount === noCount) {
    gatePassed = tiebreakerEnable;
  } else {
    gatePassed = yesCount > noCount;
  }
  return {
    yesCount,
    noCount,
    onlineCount,
    eligibleCount,
    gatePassed,
    running: Boolean(enabled && gatePassed && getMode() !== MODES.LOCKDOWN),
  };
}

function updateStatus(patch = {}) {
  status = { ...status, ...patch, updatedAt: Date.now() };
  const payload = buildAdminState(status, runtime.runHistory);
  io.sockets.sockets.forEach((socket) => {
    if (!isAdminRole(getRole(socket))) return;
    socket.emit('overseer:state', payload);
  });
}

function buildMemorySnapshot() {
  // The public UI only needs the same compact text summary that the overseer
  // already reasons over. Keeping this as text avoids exposing the raw mutable
  // store shape as a browser-facing contract.
  return {
    summary: summarizeMemory(runtime.memoryStore),
    updatedAt: Number(runtime.memoryStore?.updatedAt) || Date.now(),
  };
}

function emitMemoryToSocket(socket) {
  if (!socket) return;
  socket.emit('overseer:memory', buildMemorySnapshot());
}

function emitMemoryToAll() {
  // Memory writes are rare and user-visible, so broadcast immediately instead
  // of waiting for unrelated session sync events to refresh the popup.
  io.sockets.sockets.forEach((socket) => emitMemoryToSocket(socket));
}

function pushRun(run = {}) {
  runtime.runHistory = [...runtime.runHistory.slice(-(MAX_RUN_HISTORY - 1)), run];
}

function pushLiveToolCall(entry = {}) {
  runtime.liveToolCalls = [...runtime.liveToolCalls.slice(-49), { at: Date.now(), ...entry }];
  updateStatus({ lastLiveToolCalls: runtime.liveToolCalls });
}

async function readPrompt() {
  const raw = await fsp.readFile(PROMPT_PATH, 'utf8');
  const prompt = String(raw || '').replace(/<NAME>/g, name).trim();
  if (!prompt) throw new Error(`Prompt file empty: ${PROMPT_PATH}`);
  return prompt;
}

function buildRosterSummary() {
  return roverManager
    .getRoster()
    .filter((rover) => roverManager.canReplayRoverId(rover?.id))
    .map((rover) => {
      const roverId = String(rover?.id || '');
      const record = roverManager.rovers.get(roverId);
      const driverSocketIds = record?.drivers ? Array.from(record.drivers) : [];
      const drivers = driverSocketIds
        .map((socketId) => {
          const socket = io.sockets.sockets.get(socketId);
          const nickname = String(socket?.data?.nickname || socket?.data?.user?.username || '').trim();
          return nickname || socketId;
        })
        .filter(Boolean);
      const sensors = record?.lastSensor?.decoded || {};
      const docked = Boolean(record?.docked || sensors?.chargingSources?.homeBase);
      const oiMode = String(sensors?.oiMode?.label || '').toLowerCase();
      let statusTag = 'docking';
      if (docked) {
        statusTag = 'docked';
      } else if (oiMode === 'safe' || oiMode === 'full') {
        statusTag = 'driving';
      } else if (oiMode === 'passive' || oiMode === 'off' || oiMode === 'unknown' || !oiMode) {
        statusTag = 'docking';
      }
      return {
        id: roverId || 'unknown',
        statusTag,
        drivers,
      };
    });
}

function normalizeToolCalls(payload = null) {
  const calls = Array.isArray(payload?.message?.tool_calls) ? payload.message.tool_calls : [];
  return calls
    .map((call) => {
      const fn = call?.function || {};
      const tool = String(fn.name || '').trim();
      if (!tool) return null;
      let args = fn.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      if (!args || typeof args !== 'object') args = {};
      return { tool, args };
    })
    .filter(Boolean);
}

function inferDecision({ toolCalls, chatText }) {
  const hasTools = (toolCalls || []).length > 0;
  const hasChat = Boolean(String(chatText || '').trim());
  if (hasTools && hasChat) return 'ACTION+CHAT';
  if (hasTools) return 'ACTION';
  if (hasChat) return 'CHAT';
  return 'SKIP';
}

function normalizeChatDraft(text) {
  const next = String(text || '').trim();
  if (!next) return null;
  if (next.toUpperCase() === 'SKIP') return null;
  return next;
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(result, 'ok')) return { ok: Boolean(result.ok) };
  return null;
}

function buildToolCallFeedEntries(requestedActions = [], actionResults = []) {
  const resultsByTool = new Map();
  (actionResults || []).forEach((entry) => {
    if (!entry || entry.kind !== 'tool') return;
    const key = String(entry.tool || '');
    if (!key) return;
    if (!resultsByTool.has(key)) resultsByTool.set(key, []);
    resultsByTool.get(key).push(entry);
  });
  return (requestedActions || []).map((action) => {
    const tool = String(action?.tool || '').trim() || 'unknown';
    const bucket = resultsByTool.get(tool) || [];
    const resultEntry = bucket.length ? bucket.shift() : null;
    const ok = Boolean(resultEntry?.ok);
    const errText = resultEntry?.error ? String(resultEntry.error) : '';
    const status = resultEntry
      ? ok
        ? 'ok'
        : errText.includes('blocked') || errText.includes('unavailable')
          ? 'blocked'
          : 'error'
      : 'started';
    return {
      tool,
      status,
      args: action?.args && typeof action.args === 'object' ? action.args : {},
      result: summarizeResult(resultEntry?.result),
      error: errText || null,
    };
  });
}

function buildRecentEventsSummary() {
  const events = (runtime.liveToolCalls || [])
    .filter((entry) => entry && (entry.phase === 'ok' || entry.phase === 'error' || entry.phase === 'blocked'))
    .slice(-3)
    .map((entry) => {
      const tool = String(entry.tool || 'unknown');
      const phase = String(entry.phase || 'unknown');
      const err = entry.error ? ` error=${String(entry.error).slice(0, 60)}` : '';
      return `- tool=${tool} phase=${phase}${err}`;
    });
  if (!events.length) return '- none';
  return events.join('\n');
}

async function runDecision(triggerReason) {
  const runId = runtime.tickCount;
  updateStatus({ phase: 'context_build', currentRunId: runId, lastTriggerReason: triggerReason, lastError: null, lastErrorDetails: null });

  const mode = getMode();
  const homeAssistantState = getHomeAssistantState();
  const neatoState = getNeatoState();
  const liftState = getLiftState();
  const roster = buildRosterSummary();

  const stateUpdate = toStateUpdate({ mode, homeAssistantState, neatoState, liftState, roster, triggerReason });
  const toolState = buildToolState({ mode, homeAssistantState, neatoState, liftState });

  const recentConversation = getRecentMessages(MAX_CHAT_CONTEXT + MAX_BOT_CONTEXT + 20, { includeSystem: true })
    .filter((entry) => Number(entry?.ts || 0) >= runtime.contextResetAt)
    .filter((entry) => {
      if (!entry?.roverId) return true;
      return roverManager.canReplayRoverId(entry.roverId);
    })
    .slice(-(MAX_CHAT_CONTEXT + MAX_BOT_CONTEXT));
  const conversationMessages = buildConversation({ recentMessages: recentConversation, name });

  const systemPrompt = await readPrompt();
  const modelMessages = buildModelMessages({
    systemPrompt,
    stateUpdate,
    memorySummary: summarizeMemory(runtime.memoryStore),
    recentEvents: buildRecentEventsSummary(),
    conversationMessages,
    availableTools: toolState.available,
    blockedTools: toolState.blocked,
  });
  const ollamaTools = buildOllamaTools(toolState.availableIds);

  updateStatus({
    phase: 'awaiting_model',
    lastSystemPrompt: systemPrompt,
    lastStateUpdate: stateUpdate,
    lastTranscript: conversationMessages,
    lastAvailableTools: toolState.available,
    lastBlockedTools: toolState.blocked,
    lastModelMessages: modelMessages,
    lastModelInputAt: Date.now(),
  });

  const generationStart = Date.now();
  let payload = null;
  if (ollamaClient && model) {
    payload = await ollamaClient.chat({
      model,
      stream: false,
      keep_alive: -1,
      options: { temperature: 0.25, top_p: 0.9 },
      messages: modelMessages,
      tools: ollamaTools,
    });
  }

  const rawOutput = String(payload?.message?.content || '');
  const toolCalls = normalizeToolCalls(payload);
  const chatDraft = normalizeChatDraft(rawOutput);
  const decision = inferDecision({ toolCalls, chatText: chatDraft });

  const generationMs = Math.max(0, Date.now() - generationStart);
  runtime.generationCount += 1;
  runtime.generationTotalMs += generationMs;
  const avgGenerationMs = Math.round(runtime.generationTotalMs / runtime.generationCount);

  const actionResults = [];
  const requestedActions = toolCalls;
  let postedChat = false;
  let outcome = observeOnly ? 'observed' : 'executed';
  const reason = observeOnly ? 'observe-only mode' : null;

  if (!observeOnly) {
    if (decision === 'ACTION' || decision === 'ACTION+CHAT') {
      for (const action of requestedActions) {
        pushLiveToolCall({ phase: 'start', tool: action.tool, args: action.args });
        if (!toolState.availableIds.includes(action.tool)) {
          pushLiveToolCall({ phase: 'blocked', tool: action.tool, error: 'tool unavailable or blocked' });
          actionResults.push({ kind: 'tool', tool: action.tool, ok: false, error: 'tool unavailable or blocked' });
          continue;
        }
        try {
          const result = await executeToolAction(action.tool, action.args, {
            sendSystemMessage,
            name,
            memoryStore: runtime.memoryStore,
            neatoService,
            liftService,
            homeAssistantService,
            buttonBoxService,
            actor: 'overseerControl',
          });
          if (result?.memory && typeof result.memory === 'object') {
            runtime.memoryStore = saveMemory(result.memory);
            emitMemoryToAll();
          }
          pushLiveToolCall({ phase: 'ok', tool: action.tool, result });
          actionResults.push({ kind: 'tool', tool: action.tool, ok: true, result });
        } catch (err) {
          pushLiveToolCall({ phase: 'error', tool: action.tool, error: err.message });
          actionResults.push({ kind: 'tool', tool: action.tool, ok: false, error: err.message });
        }
      }
    }

    const toolCallFeed = buildToolCallFeedEntries(requestedActions, actionResults);
    if (toolCallFeed.length > 0) {
      if ((decision === 'CHAT' || decision === 'ACTION+CHAT') && chatDraft) {
        sendSystemMessage(chatDraft, { nickname: name, bot: true, profileImage: profileImageUrl, toolCalls: toolCallFeed });
        postedChat = true;
      } else if (postToolsOnlyMessages) {
        sendSystemMessage('', { nickname: name, bot: true, profileImage: profileImageUrl, toolCalls: toolCallFeed });
      }
    } else if ((decision === 'CHAT' || decision === 'ACTION+CHAT') && chatDraft) {
      sendSystemMessage(chatDraft, { nickname: name, bot: true, profileImage: profileImageUrl });
      postedChat = true;
    }
  }

  updateStatus({
    phase: 'decision_recorded',
    lastModelOutputAt: Date.now(),
    lastModelRawOutput: rawOutput,
    lastDecision: decision,
    lastChatDraft: chatDraft,
    lastRequestedActions: requestedActions,
    lastActionResults: actionResults,
    lastOutcome: outcome,
    lastReason: reason,
    lastGenerationMs: generationMs,
    avgGenerationMs,
    generationCount: runtime.generationCount,
  });

  pushRun({
    runId,
    at: Date.now(),
    triggerReason,
    decision,
    chatDraft,
    requestedActions,
    actionResults,
    outcome,
    observeOnly,
    generationMs,
    blockedTools: toolState.blocked,
  });

  return { postedChat };
}

async function tick() {
  // The scheduler is deliberately loop-only. Older versions mixed chat-triggered
  // and heartbeat-triggered paths into this same timer, which made it possible
  // for one slow model generation to be followed by another run that was still
  // reasoning over the same chat message. In the loop model, every completed
  // timer means exactly one model request, and the next timer is not installed
  // until the current request has completely finished.
  const startedAt = Date.now();

  // setTimeout handles are one-shot. Clearing the reference at the beginning of
  // the callback makes scheduler ownership obvious: if any gate reevaluation
  // happens while this tick is running, startScheduler can see that work is
  // already in-flight and will not create a competing timer.
  runtime.timer = null;

  if (runtime.inFlight) {
    // This is a defensive guard for unusual event-loop races or manual calls.
    // Sending the same model input twice is worse than skipping one interval,
    // so a re-entrant tick is ignored and the active tick remains responsible
    // for scheduling the next pass.
    updateStatus({
      phase: 'idle',
      lastOutcome: 'skipped',
      lastReason: 'loop tick skipped while model request is in flight',
    });
    return;
  }

  runtime.tickCount += 1;
  runtime.inFlight = true;
  updateStatus({
    inFlight: true,
    tickCount: runtime.tickCount,
    lastTickAt: startedAt,
    phase: 'loop_tick',
    lastTriggerReason: 'loop_tick',
  });

  try {
    await runDecision('loop_tick');
  } catch (err) {
    const failure = buildFailureInfo(err);
    updateStatus({
      phase: 'failed',
      lastError: failure.message,
      lastErrorDetails: failure.details,
      lastFailedAt: Date.now(),
      lastOutcome: 'failed',
      lastReason: 'exception',
    });
  } finally {
    runtime.inFlight = false;
    if (status.running) {
      const nextRunAt = Date.now() + gateIntervalMs;
      updateStatus({ inFlight: false, currentRunId: null, phase: 'idle', nextRunAt });

      // The next timer is installed after all async work completes. This keeps
      // Ollama calls strictly serialized even when a generation takes longer
      // than gateIntervalMs.
      runtime.timer = setTimeout(tick, gateIntervalMs);
    } else {
      updateStatus({ inFlight: false, currentRunId: null, nextRunAt: null });
    }
  }
}

function emitStateToSocket(socket) {
  if (!socket || !isAdminRole(getRole(socket))) return;
  socket.emit('overseer:state', buildAdminState(status, runtime.runHistory));
}

function clearHistory(reason = 'admin requested clear history', options = {}) {
  const resetPersistentMemory = options?.resetPersistentMemory !== false;
  const sendConfirmation = options?.sendConfirmation === true;
  runtime.contextResetAt = Date.now();
  runtime.runHistory = [];
  runtime.liveToolCalls = [];
  runtime.generationCount = 0;
  runtime.generationTotalMs = 0;
  if (resetPersistentMemory) {
    runtime.memoryStore = saveMemory(createDefaultMemory());
    emitMemoryToAll();
  }
  updateStatus({
    phase: 'idle',
    currentRunId: null,
    lastSystemPrompt: null,
    lastStateUpdate: null,
    lastTranscript: null,
    lastAvailableTools: null,
    lastBlockedTools: null,
    lastModelMessages: null,
    lastModelInputAt: null,
    lastModelOutputAt: null,
    lastModelRawOutput: null,
    lastDecision: null,
    lastChatDraft: null,
    lastRequestedActions: null,
    lastActionResults: null,
    lastLiveToolCalls: [],
    lastOutcome: 'cleared',
    lastReason: reason,
  });
  if (sendConfirmation) {
    sendSystemMessage('Context cleared.', { nickname: name, bot: true, profileImage: profileImageUrl });
  }
}

function stopScheduler(reason = 'paused') {
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = null;
  }
  updateStatus({
    running: false,
    inFlight: false,
    currentRunId: null,
    nextRunAt: null,
    phase: 'paused',
    lastOutcome: 'paused',
    lastReason: reason,
  });
}

function startScheduler(reason = null) {
  // Gate changes can happen while a loop iteration is still waiting on Ollama.
  // In that case we mark the service as running again, but let the active tick's
  // finally block install the next timer. That preserves a single owner for
  // scheduling and prevents overlapping model requests.
  updateStatus({ running: true, phase: runtime.inFlight ? status.phase : 'idle', lastReason: reason });
  if (runtime.timer || runtime.inFlight) return;
  runtime.timer = setTimeout(tick, gateIntervalMs);
}

function evaluateSchedulerGate(reason = 'gate reevaluated') {
  const voteStatus = buildVoteStatus();
  updateStatus({ voteStatus });
  if (!enabled) {
    stopScheduler('overseerControl.enabled is false');
    return;
  }
  if (getMode() === MODES.LOCKDOWN) {
    stopScheduler('paused during lockdown');
    return;
  }
  if (!voteStatus.gatePassed) {
    stopScheduler('paused by user vote');
    return;
  }
  startScheduler(reason);
}

io.on('connection', (socket) => {
  emitStateToSocket(socket);
  emitMemoryToSocket(socket);
  evaluateSchedulerGate('online vote update');
  socket.on('disconnect', () => evaluateSchedulerGate('online vote update'));
  socket.on('overseer:control', ({ controls } = {}, cb = () => {}) => {
    if (!isAdminRole(getRole(socket))) return cb({ error: 'Not authorized' });
    const action = controls?.action || null;
    if (action === 'clearHistory') {
      clearHistory();
      return cb({ success: true, state: buildAdminState(status, runtime.runHistory) });
    }
    return cb({ error: 'Unknown overseer control action' });
  });
});

roleEvents.on('change', ({ socket }) => {
  emitStateToSocket(socket);
  evaluateSchedulerGate('online vote update');
});
subscribe('chat:message', ({ payload } = {}) => {
  const text = String(payload?.text || '').trim();
  if (text !== 'CLEAR') return;
  if (payload?.bot) return;
  clearHistory('chat CLEAR command', { resetPersistentMemory: false, sendConfirmation: true });
});
verificationEvents.on('change', () => evaluateSchedulerGate('online vote update'));
homeAssistantEvents.on('update', () => updateStatus({ phase: status.phase }));
neatoEvents.on('update', () => updateStatus({ phase: status.phase }));
liftEvents.on('update', () => updateStatus({ phase: status.phase }));
roverManager.managerEvents.on('rover', () => updateStatus({ phase: status.phase }));
modeEvents.on('change', (mode) => {
  if (!enabled) return;
  if (mode === MODES.LOCKDOWN) {
    stopScheduler('paused during lockdown');
    logger.info('overseerControl paused due to lockdown mode');
    return;
  }
  evaluateSchedulerGate(observeOnly ? 'observe-only mode' : null);
});

if (!enabled) {
  logger.info('overseerControl disabled');
  updateStatus({ running: false, lastReason: 'overseerControl.enabled is false' });
} else {
  if (getMode() === MODES.LOCKDOWN) {
    stopScheduler('paused during lockdown');
    logger.info('overseerControl paused on startup due to lockdown mode');
  } else {
    evaluateSchedulerGate(observeOnly ? 'observe-only mode' : null);
    logger.info('overseerControl enabled', { model, ollamaUrl, gateIntervalMs, observeOnly });
  }
}

module.exports = {
  getVoteStatus: () => status.voteStatus || buildVoteStatus(),
};
