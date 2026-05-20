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
const { getRecentMessages, sendSystemMessage, clearHistory: clearChatHistory } = require('../chatService');
const { subscribe } = require('../eventBus');
const {
  PROMPT_PATH,
  DEFAULT_NAME,
  DEFAULT_GATE_INTERVAL_MS,
  DEFAULT_HEARTBEAT_MS,
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
const heartbeatMs = normalizeMs(Number(overseerConfig.heartbeatMs), DEFAULT_HEARTBEAT_MS);
const alwaysRunModel = Boolean(overseerConfig.alwaysRunModel);
const postToolsOnlyMessages = Boolean(overseerConfig.postToolsOnlyMessages);
const profileImageUrl = String(overseerConfig.profileImageUrl || '').trim() || null;
const ollamaClient = ollamaUrl ? new Ollama({ host: ollamaUrl }) : null;

const runtime = {
  timer: null,
  inFlight: false,
  tickCount: 0,
  lastModelAt: 0,
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
  heartbeatMs,
  alwaysRunModel,
  postToolsOnlyMessages,
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
  const gatePassed = eligibleCount === 0 ? true : yesCount > noCount;
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

function computeTriggerReason() {
  if (alwaysRunModel) return 'loop_tick';
  const recent = getRecentMessages(1, { includeSystem: false });
  const last = recent[recent.length - 1];
  if (last && Number(last.ts || 0) < runtime.contextResetAt) return null;
  if (last && Date.now() - Number(last.ts || 0) < 5000) {
    const txt = String(last.text || '').toLowerCase();
    if (txt.includes(name.toLowerCase()) || txt.includes('overseer') || txt.includes('bot')) return 'direct_address';
    return 'chat_activity';
  }
  if (!runtime.lastModelAt || Date.now() - runtime.lastModelAt >= heartbeatMs) return 'heartbeat';
  return null;
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
  runtime.lastModelAt = Date.now();

  const actionResults = [];
  const requestedActions = toolCalls;
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
      } else if (postToolsOnlyMessages) {
        sendSystemMessage('', { nickname: name, bot: true, profileImage: profileImageUrl, toolCalls: toolCallFeed });
      }
    } else if ((decision === 'CHAT' || decision === 'ACTION+CHAT') && chatDraft) {
      sendSystemMessage(chatDraft, { nickname: name, bot: true, profileImage: profileImageUrl });
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
}

async function tick() {
  runtime.tickCount += 1;
  runtime.inFlight = true;
  updateStatus({ inFlight: true, tickCount: runtime.tickCount, lastTickAt: Date.now(), phase: 'gate_check' });

  try {
    const triggerReason = computeTriggerReason();
    if (!triggerReason) {
      updateStatus({ phase: 'idle', lastOutcome: 'skipped', lastReason: 'gate not triggered' });
    } else {
      await runDecision(triggerReason);
    }
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
      updateStatus({ inFlight: false, currentRunId: null, phase: 'idle', nextRunAt: Date.now() + gateIntervalMs });
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
  runtime.lastModelAt = 0;
  if (resetPersistentMemory) {
    runtime.memoryStore = saveMemory(createDefaultMemory());
  }
  try {
    clearChatHistory();
  } catch (err) {
    logger.warn('Failed to clear chat history during overseer clear', err.message);
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
  if (runtime.timer) return;
  updateStatus({ running: true, phase: 'idle', lastReason: reason });
  runtime.timer = setTimeout(tick, gateIntervalMs);
}

function evaluateSchedulerGate(reason = 'gate reevaluated') {
  const voteStatus = buildVoteStatus();
  const runningAllowed = Boolean(enabled && voteStatus.gatePassed && getMode() !== MODES.LOCKDOWN);
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
    logger.info('overseerControl enabled', { model, ollamaUrl, gateIntervalMs, heartbeatMs, observeOnly });
  }
}

module.exports = {
  getVoteStatus: () => status.voteStatus || buildVoteStatus(),
};
