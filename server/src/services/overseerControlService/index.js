const fsp = require('fs/promises');
const { Ollama } = require('ollama');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('overseerControl');
const { loadConfig } = require('../../helpers/configLoader');
const { getRole, roleEvents } = require('../roleService');
const { getMode } = require('../modeManager');
const homeAssistantService = require('../homeAssistantService');
const neatoService = require('../neatoService');
const liftService = require('../liftService');
const { getState: getHomeAssistantState, homeAssistantEvents } = homeAssistantService;
const { getState: getNeatoState, neatoEvents } = neatoService;
const { getState: getLiftState, liftEvents } = liftService;
const roverManager = require('../roverManager');
const { getRecentMessages, sendSystemMessage } = require('../chatService');
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
const { isAdminRole, buildAdminState, parseOverseerOutput, buildFailureInfo } = require('./runtimeHelpers');
const { toStateUpdate, buildToolState, buildConversation, buildModelMessages } = require('./contextBuilder');
const { executeToolAction } = require('./tools');

const config = loadConfig();
const overseerConfig = config.overseerControl || {};
const enabled = Boolean(overseerConfig.enabled);
const observeOnly = overseerConfig.observeOnly !== false;
const name = String(overseerConfig.name || DEFAULT_NAME).trim() || DEFAULT_NAME;
const model = String(overseerConfig.model || '').trim();
const ollamaUrl = String(overseerConfig.ollamaUrl || overseerConfig.ollamaServer || '').trim();
const gateIntervalMs = normalizeMs(Number(overseerConfig.gateIntervalMs), DEFAULT_GATE_INTERVAL_MS);
const heartbeatMs = normalizeMs(Number(overseerConfig.heartbeatMs), DEFAULT_HEARTBEAT_MS);
const ollamaClient = ollamaUrl ? new Ollama({ host: ollamaUrl }) : null;

const runtime = {
  timer: null,
  inFlight: false,
  tickCount: 0,
  lastModelAt: 0,
  generationCount: 0,
  generationTotalMs: 0,
  runHistory: [],
  memoryStore: ['', '', ''],
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
  lastOutcome: null,
  lastReason: null,
  lastError: null,
  lastErrorDetails: null,
  lastFailedAt: null,
  lastGenerationMs: null,
  avgGenerationMs: null,
  generationCount: 0,
  updatedAt: Date.now(),
};

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

async function readPrompt() {
  const raw = await fsp.readFile(PROMPT_PATH, 'utf8');
  const prompt = String(raw || '').replace(/<NAME>/g, name).trim();
  if (!prompt) throw new Error(`Prompt file empty: ${PROMPT_PATH}`);
  return prompt;
}

function buildRosterSummary() {
  return roverManager.getRoster().map((rover) => ({
    id: rover?.id || 'unknown',
    statusTag: rover?.statusTag || 'unknown',
    driverNickname: rover?.driverNickname || null,
  }));
}

function computeTriggerReason() {
  const recent = getRecentMessages(1, { includeSystem: false });
  const last = recent[recent.length - 1];
  if (last && Date.now() - Number(last.ts || 0) < 5000) {
    const txt = String(last.text || '').toLowerCase();
    if (txt.includes(name.toLowerCase()) || txt.includes('overseer') || txt.includes('bot')) return 'direct_address';
    return 'chat_activity';
  }
  if (!runtime.lastModelAt || Date.now() - runtime.lastModelAt >= heartbeatMs) return 'heartbeat';
  return null;
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

  const recentConversation = getRecentMessages(MAX_CHAT_CONTEXT + MAX_BOT_CONTEXT, { includeSystem: true });
  const conversationMessages = buildConversation({ recentMessages: recentConversation, name });

  const systemPrompt = await readPrompt();
  const modelMessages = buildModelMessages({
    systemPrompt,
    stateUpdate,
    conversationMessages,
    availableTools: toolState.available,
    blockedTools: toolState.blocked,
  });

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

  let parsed = { decision: 'SKIP', chat: null, actions: [], raw: '' };
  const generationStart = Date.now();
  if (ollamaClient && model) {
    const payload = await ollamaClient.chat({
      model,
      stream: false,
      keep_alive: -1,
      options: { temperature: 0.4, top_p: 0.9 },
      messages: modelMessages,
    });
    parsed = parseOverseerOutput(payload?.message?.content || '');
  }

  const generationMs = Math.max(0, Date.now() - generationStart);
  runtime.generationCount += 1;
  runtime.generationTotalMs += generationMs;
  const avgGenerationMs = Math.round(runtime.generationTotalMs / runtime.generationCount);
  runtime.lastModelAt = Date.now();

  const actionResults = [];
  let outcome = observeOnly ? 'observed' : 'executed';
  let reason = observeOnly ? 'observe-only mode' : null;

  if (!observeOnly) {
    if ((parsed.decision === 'CHAT' || parsed.decision === 'ACTION+CHAT') && parsed.chat) {
      sendSystemMessage(parsed.chat, { nickname: name });
      actionResults.push({ kind: 'chat', ok: true });
    }

    if (parsed.decision === 'ACTION' || parsed.decision === 'ACTION+CHAT') {
      for (const action of parsed.actions) {
        const isAvailable = toolState.available.some((signature) => signature.startsWith(`${action.tool}(`));
        if (!isAvailable) {
          actionResults.push({ kind: 'tool', tool: action.tool, ok: false, error: 'tool unavailable or blocked' });
          continue;
        }
        try {
          const result = await executeToolAction(action, {
            sendSystemMessage,
            name,
            memoryStore: runtime.memoryStore,
            neatoService,
            liftService,
            homeAssistantService,
            actor: 'overseerControl',
          });
          if (action.tool === 'memory_write' && Array.isArray(result?.slots)) {
            runtime.memoryStore = result.slots;
          }
          actionResults.push({ kind: 'tool', tool: action.tool, ok: true, result });
        } catch (err) {
          actionResults.push({ kind: 'tool', tool: action.tool, ok: false, error: err.message });
        }
      }
    }
  }

  updateStatus({
    phase: 'decision_recorded',
    lastModelOutputAt: Date.now(),
    lastModelRawOutput: parsed.raw,
    lastDecision: parsed.decision,
    lastChatDraft: parsed.chat,
    lastRequestedActions: parsed.actions,
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
    decision: parsed.decision,
    chatDraft: parsed.chat,
    requestedActions: parsed.actions,
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
    updateStatus({ inFlight: false, currentRunId: null, phase: 'idle', nextRunAt: Date.now() + gateIntervalMs });
    runtime.timer = setTimeout(tick, gateIntervalMs);
  }
}

function emitStateToSocket(socket) {
  if (!socket || !isAdminRole(getRole(socket))) return;
  socket.emit('overseer:state', buildAdminState(status, runtime.runHistory));
}

function clearHistory() {
  runtime.runHistory = [];
  runtime.generationCount = 0;
  runtime.generationTotalMs = 0;
  runtime.memoryStore = ['', '', ''];
  updateStatus({ lastReason: 'admin requested clear history', lastOutcome: 'cleared' });
}

io.on('connection', (socket) => {
  emitStateToSocket(socket);
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

roleEvents.on('change', ({ socket }) => emitStateToSocket(socket));
homeAssistantEvents.on('update', () => updateStatus({ phase: status.phase }));
neatoEvents.on('update', () => updateStatus({ phase: status.phase }));
liftEvents.on('update', () => updateStatus({ phase: status.phase }));
roverManager.managerEvents.on('rover', () => updateStatus({ phase: status.phase }));

if (!enabled) {
  logger.info('overseerControl disabled');
  updateStatus({ running: false, lastReason: 'overseerControl.enabled is false' });
} else {
  updateStatus({ running: true, lastReason: observeOnly ? 'observe-only mode' : null });
  runtime.timer = setTimeout(tick, gateIntervalMs);
  logger.info('overseerControl enabled', { model, ollamaUrl, gateIntervalMs, heartbeatMs, observeOnly });
}

module.exports = {};
