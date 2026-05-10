// llm Commentary Service
// Purpose: Composes commentary runtime modules (snapshot engine, runner, hooks) and exports startup wiring.
// Scope: Keeps runtime behavior unchanged while making this entrypoint a thin orchestration layer.
const fsp = require('fs/promises');
const { Ollama } = require('ollama');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('llmCommentary');
const { loadConfig } = require('../../helpers/configLoader');
const { getRole, roleEvents } = require('../roleService');
const { getMode, MODES, modeEvents } = require('../modeManager');
const roverManager = require('../roverManager');
const { getActiveDrivers } = require('../turnService');
const { getNickname } = require('../nicknameService');
const { getRecentMessages, sendSystemMessage } = require('../chatService');
const {
  PROMPT_PATH,
  JITTER_MS,
  MAX_ROVERS,
  MAX_CHAT_MESSAGES,
  MAX_BOT_MESSAGES,
  ACTIVITY_WINDOW_MS,
  ACTIVITY_BUCKET_MS,
  ACTIVITY_SCORE_WINDOW_MS,
  SELF_TALK_WINDOW_MS,
  MAX_CONTEXT_EVENTS,
  MAX_RUN_HISTORY,
  MAX_ROVER_EVENTS,
  POST_COOLDOWN_MS,
  normalizeFrequencyMs,
} = require('./constants');
const { parseModelOutput, normalizeDuplicateKey, buildModelMessages } = require('./formatters');
const { isAdminRole, buildAdminState, buildFailureInfo } = require('./runtimeHelpers');
const { createSnapshotEngine } = require('./snapshotEngine');
const { registerHooks } = require('./hooks');
const { createRunner } = require('./runner');

const config = loadConfig();
const commentaryConfig = config.llmCommentary || {};
const enabled = Boolean(commentaryConfig.enabled);
const ollamaUrl = String(commentaryConfig.ollamaUrl || commentaryConfig.ollamaServer || '').trim();
const model = String(commentaryConfig.model || '').trim();
const ollamaClient = ollamaUrl ? new Ollama({ host: ollamaUrl }) : null;
const frequencyMs = normalizeFrequencyMs(Number(commentaryConfig.frequency ?? commentaryConfig.frequencyMs));

const runtime = {
  timer: null,
  inFlight: false,
  tickCount: 0,
  skipStreak: 0,
  generationCount: 0,
  generationTotalMs: 0,
  contextResetAt: Date.now(),
  clearCount: 0,
  runHistory: [],
  currentRun: null,
};

let status = {
  enabled,
  model,
  ollamaUrl,
  frequencyMs,
  jitterMs: JITTER_MS,
  promptPath: PROMPT_PATH,
  running: false,
  inFlight: false,
  tickCount: 0,
  nextRunAt: null,
  lastTickAt: null,
  lastOutcome: null,
  lastReason: null,
  phase: 'idle',
  phaseAt: Date.now(),
  currentRunId: null,
  lastError: null,
  lastErrorDetails: null,
  lastFailedAt: null,
  lastPromptReadAt: null,
  lastPromptChars: 0,
  lastSystemPrompt: null,
  lastInfoSnapshot: null,
  lastModelMessages: null,
  lastModelInputAt: null,
  lastModelInputTickId: null,
  lastModelRawOutput: null,
  lastModelOutputAt: null,
  lastModelOutputTickId: null,
  lastSnapshotSummary: null,
  lastClearedAt: runtime.contextResetAt,
  clearCount: runtime.clearCount,
  skipStreak: 0,
  lastGenerationMs: null,
  avgGenerationMs: null,
  generationCount: 0,
  lastGeneratedText: null,
  lastPostedText: null,
  lastPostedAt: null,
  updatedAt: Date.now(),
};

function isAdminSocket(socket) {
  if (!socket) return false;
  return isAdminRole(getRole(socket));
}

function emitStatusToSocket(socket) {
  if (!socket || !isAdminSocket(socket)) return;
  socket.emit('llm:state', buildAdminState(status, runtime.runHistory));
}

function emitStatusToAdmins() {
  const payload = buildAdminState(status, runtime.runHistory);
  io.sockets.sockets.forEach((socket) => {
    if (!isAdminSocket(socket)) return;
    socket.emit('llm:state', payload);
  });
}

function updateStatus(patch = {}) {
  const next = {
    ...status,
    ...patch,
    updatedAt: Date.now(),
  };
  if (JSON.stringify(next) === JSON.stringify(status)) return;
  status = next;
  emitStatusToAdmins();
}

function updatePhase(phase, patch = {}) {
  updateStatus({
    phase,
    phaseAt: Date.now(),
    ...patch,
  });
}

function startRunRecord(tickId, snapshotSummary) {
  runtime.currentRun = {
    runId: tickId,
    startedAt: Date.now(),
    endedAt: null,
    phase: 'tick_started',
    outcome: null,
    reason: null,
    durationMs: null,
    summary: snapshotSummary || {},
    input: {
      systemPrompt: null,
      infoSnapshot: null,
      modelMessages: null,
      modelInputAt: null,
    },
    output: {
      raw: null,
      normalized: null,
      posted: null,
      postedAt: null,
      modelOutputAt: null,
    },
    errors: null,
  };
}

function patchCurrentRun(patch = {}) {
  if (!runtime.currentRun) return;
  runtime.currentRun = {
    ...runtime.currentRun,
    ...patch,
  };
}

function finalizeRunRecord({ outcome, reason, errors } = {}) {
  if (!runtime.currentRun) return;
  const endedAt = Date.now();
  const finalized = {
    ...runtime.currentRun,
    outcome: outcome ?? runtime.currentRun.outcome,
    reason: reason ?? runtime.currentRun.reason,
    errors: errors ?? runtime.currentRun.errors ?? null,
    endedAt,
    durationMs: Math.max(0, endedAt - Number(runtime.currentRun.startedAt || endedAt)),
  };
  runtime.runHistory = [...runtime.runHistory.slice(-(MAX_RUN_HISTORY - 1)), finalized];
  runtime.currentRun = null;
}

async function readSystemPrompt() {
  const prompt = await fsp.readFile(PROMPT_PATH, 'utf8');
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error(`Prompt file empty: ${PROMPT_PATH}`);
  }
  updateStatus({
    lastPromptReadAt: Date.now(),
    lastPromptChars: trimmed.length,
    lastSystemPrompt: trimmed,
  });
  return trimmed;
}

async function generateCommentary(messages) {
  if (!ollamaClient) {
    throw new Error('Ollama client unavailable');
  }
  const payload = await ollamaClient.chat({
    model,
    stream: false,
    keep_alive: -1,
    options: {
      temperature: 0.5,
      top_p: 0.9,
    },
    messages,
  });
  return parseModelOutput(payload?.message?.content);
}

const snapshotEngine = createSnapshotEngine({
  io,
  roverManager,
  getActiveDrivers,
  getNickname,
  getRecentMessages,
  MAX_ROVERS,
  MAX_CHAT_MESSAGES,
  ACTIVITY_WINDOW_MS,
  ACTIVITY_BUCKET_MS,
  ACTIVITY_SCORE_WINDOW_MS,
  SELF_TALK_WINDOW_MS,
  MAX_CONTEXT_EVENTS,
  MAX_ROVER_EVENTS,
  getContextResetAt: () => runtime.contextResetAt,
  getSkipStreak: () => runtime.skipStreak,
});

const runner = createRunner({
  logger,
  enabled,
  model,
  ollamaUrl,
  frequencyMs,
  jitterMs: JITTER_MS,
  postCooldownMs: POST_COOLDOWN_MS,
  maxBotMessages: MAX_BOT_MESSAGES,
  runtime,
  snapshotEngine,
  readSystemPrompt,
  buildModelMessages,
  generateCommentary,
  normalizeDuplicateKey,
  getRecentMessages,
  sendSystemMessage,
  buildFailureInfo,
  updatePhase,
  startRunRecord,
  patchCurrentRun,
  finalizeRunRecord,
  updateStatus,
});

const canRunFromConfig = enabled && model && ollamaUrl;

if (canRunFromConfig) {
  registerHooks({
    io,
    roleEvents,
    roverManager,
    emitStatusToSocket,
    isAdminSocket,
    clearRuntimeHistory: runner.clearRuntimeHistory,
    getAdminState: () => buildAdminState(status, runtime.runHistory),
    onDriverActivity: runner.wakeForDriverActivity,
    onSensorEvent: snapshotEngine.onSensorEvent,
    onRoverRemoved: snapshotEngine.removeRover,
  });

  const mode = getMode();
  if (mode === MODES.LOCKDOWN) {
    runner.stop('paused during lockdown');
    logger.info('LLM commentary paused due to lockdown mode');
  } else {
    runner.start();
  }

  modeEvents.on('change', (nextMode) => {
    if (nextMode === MODES.LOCKDOWN) {
      runner.stop('paused during lockdown');
      logger.info('LLM commentary paused due to lockdown mode');
      return;
    }
    runner.start();
  });
} else {
  const disabledReason = !enabled
    ? 'llmCommentary.enabled is false'
    : 'model or ollama server missing';
  updatePhase('disabled', {
    running: false,
    inFlight: false,
    currentRunId: null,
    lastOutcome: 'disabled',
    lastReason: disabledReason,
  });
  logger.info('LLM commentary service not started', { reason: disabledReason });
}
