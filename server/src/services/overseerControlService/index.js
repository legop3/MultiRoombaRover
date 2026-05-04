const fsp = require('fs/promises');
const { Ollama } = require('ollama');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('overseerControl');
const { loadConfig } = require('../../helpers/configLoader');
const { getRole, roleEvents } = require('../roleService');
const { getMode } = require('../modeManager');
const { getState: getHomeAssistantState, homeAssistantEvents } = require('../homeAssistantService');
const { getState: getNeatoState, neatoEvents } = require('../neatoService');
const { getState: getLiftState, liftEvents } = require('../liftService');
const roverManager = require('../roverManager');
const { getRecentMessages } = require('../chatService');
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
const {
  isAdminRole,
  buildAdminState,
  normalizeDecision,
  buildFailureInfo,
} = require('./runtimeHelpers');
const {
  toStateUpdate,
  buildToolState,
  buildConversation,
  buildModelMessages,
} = require('./contextBuilder');

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
  running: false,
  tickCount: 0,
  lastModelAt: 0,
  generationCount: 0,
  generationTotalMs: 0,
  runHistory: [],
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
  status = {
    ...status,
    ...patch,
    updatedAt: Date.now(),
  };
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
    if (txt.includes(name.toLowerCase()) || txt.includes('overseer') || txt.includes('bot')) {
      return 'direct_address';
    }
    return 'chat_activity';
  }
  if (!runtime.lastModelAt || Date.now() - runtime.lastModelAt >= heartbeatMs) {
    return 'heartbeat';
  }
  return null;
}

async function runDecision(triggerReason) {
  const runId = runtime.tickCount;
  updateStatus({
    phase: 'context_build',
    currentRunId: runId,
    lastTriggerReason: triggerReason,
    lastError: null,
    lastErrorDetails: null,
  });

  const mode = getMode();
  const homeAssistantState = getHomeAssistantState();
  const neatoState = getNeatoState();
  const liftState = getLiftState();
  const roster = buildRosterSummary();

  const stateUpdate = toStateUpdate({ mode, homeAssistantState, neatoState, liftState, roster, triggerReason });
  const toolState = buildToolState({ mode, homeAssistantState, neatoState, liftState });

  const human = getRecentMessages(MAX_CHAT_CONTEXT, { includeSystem: false });
  const bots = getRecentMessages(100, { includeSystem: true })
    .filter((entry) => entry?.system)
    .slice(-MAX_BOT_CONTEXT);
  const transcriptRows = buildConversation({ recentMessages: [...human, ...bots].slice(-(MAX_CHAT_CONTEXT + MAX_BOT_CONTEXT)), name });

  const systemPrompt = await readPrompt();
  const modelMessages = buildModelMessages({
    systemPrompt,
    stateUpdate,
    transcriptRows,
    availableTools: toolState.available,
    blockedTools: toolState.blocked,
  });

  updateStatus({
    phase: 'awaiting_model',
    lastSystemPrompt: systemPrompt,
    lastStateUpdate: stateUpdate,
    lastTranscript: transcriptRows,
    lastAvailableTools: toolState.available,
    lastBlockedTools: toolState.blocked,
    lastModelMessages: modelMessages,
    lastModelInputAt: Date.now(),
  });

  let decision = 'SKIP';
  let rawOutput = '';
  const generationStart = Date.now();
  if (ollamaClient && model) {
    const payload = await ollamaClient.chat({
      model,
      stream: false,
      keep_alive: -1,
      options: {
        temperature: 0.4,
        top_p: 0.9,
      },
      messages: modelMessages,
    });
    const parsed = normalizeDecision(payload?.message?.content || '');
    rawOutput = parsed.raw;
    decision = parsed.decision;
  }

  const generationMs = Math.max(0, Date.now() - generationStart);
  runtime.generationCount += 1;
  runtime.generationTotalMs += generationMs;
  const avgGenerationMs = Math.round(runtime.generationTotalMs / runtime.generationCount);

  runtime.lastModelAt = Date.now();
  const outcome = observeOnly ? 'observed' : 'pending_execution';

  updateStatus({
    phase: 'decision_recorded',
    lastModelOutputAt: Date.now(),
    lastModelRawOutput: rawOutput,
    lastDecision: decision,
    lastOutcome: outcome,
    lastReason: observeOnly ? 'observe-only mode' : null,
    lastGenerationMs: generationMs,
    avgGenerationMs,
    generationCount: runtime.generationCount,
  });

  pushRun({
    runId,
    at: Date.now(),
    triggerReason,
    decision,
    outcome,
    observeOnly,
    generationMs,
    blockedTools: toolState.blocked,
  });
}

async function tick() {
  runtime.tickCount += 1;
  runtime.inFlight = true;
  updateStatus({
    inFlight: true,
    tickCount: runtime.tickCount,
    lastTickAt: Date.now(),
    phase: 'gate_check',
  });

  try {
    const triggerReason = computeTriggerReason();
    if (!triggerReason) {
      updateStatus({
        phase: 'idle',
        lastOutcome: 'skipped',
        lastReason: 'gate not triggered',
      });
      return;
    }
    await runDecision(triggerReason);
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
    updateStatus({
      inFlight: false,
      currentRunId: null,
      phase: 'idle',
      nextRunAt: Date.now() + gateIntervalMs,
    });
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
  updateStatus({
    lastReason: 'admin requested clear history',
    lastOutcome: 'cleared',
  });
}

io.on('connection', (socket) => {
  emitStateToSocket(socket);
  socket.on('overseer:control', ({ controls } = {}, cb = () => {}) => {
    if (!isAdminRole(getRole(socket))) {
      cb({ error: 'Not authorized' });
      return;
    }
    const action = controls?.action || null;
    if (action === 'clearHistory') {
      clearHistory();
      cb({ success: true, state: buildAdminState(status, runtime.runHistory) });
      return;
    }
    cb({ error: 'Unknown overseer control action' });
  });
});

roleEvents.on('change', ({ socket }) => {
  emitStateToSocket(socket);
});

homeAssistantEvents.on('update', () => {
  updateStatus({ phase: status.phase });
});
neatoEvents.on('update', () => {
  updateStatus({ phase: status.phase });
});
liftEvents.on('update', () => {
  updateStatus({ phase: status.phase });
});
roverManager.managerEvents.on('rover', () => {
  updateStatus({ phase: status.phase });
});

if (!enabled) {
  logger.info('overseerControl disabled');
  updateStatus({ running: false, lastReason: 'overseerControl.enabled is false' });
} else {
  runtime.running = true;
  updateStatus({ running: true, lastReason: observeOnly ? 'observe-only mode' : null });
  runtime.timer = setTimeout(tick, gateIntervalMs);
  logger.info('overseerControl enabled', { model, ollamaUrl, gateIntervalMs, heartbeatMs, observeOnly });
}

module.exports = {};
