// llm Commentary Service
// Purpose: Defines the llm Commentary Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fsp = require('fs/promises');
const { Ollama } = require('ollama');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('llmCommentary');
const { loadConfig } = require('../../helpers/configLoader');
const { getRole, roleEvents } = require('../roleService');
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
const {
  parseModelOutput,
  normalizeDuplicateKey,
  buildModelMessages,
} = require('./formatters');
const {
  isAdminRole,
  buildAdminState,
  buildFailureInfo,
} = require('./runtimeHelpers');
const { createSnapshotEngine } = require('./snapshotEngine');

const config = loadConfig();
const commentaryConfig = config.llmCommentary || {};
const enabled = Boolean(commentaryConfig.enabled);
const ollamaUrl = String(
  commentaryConfig.ollamaUrl || commentaryConfig.ollamaServer || '',
).trim();
const model = String(commentaryConfig.model || '').trim();
const ollamaClient = ollamaUrl ? new Ollama({ host: ollamaUrl }) : null;

let timer = null;
let inFlight = false;
let tickCount = 0;
let skipStreak = 0;
let generationCount = 0;
let generationTotalMs = 0;
let contextResetAt = Date.now();
let clearCount = 0;
let runHistory = [];
let currentRun = null;
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
  getContextResetAt: () => contextResetAt,
  getSkipStreak: () => skipStreak,
});

const frequencyMs = normalizeFrequencyMs(Number(commentaryConfig.frequency ?? commentaryConfig.frequencyMs));
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
  lastClearedAt: contextResetAt,
  clearCount,
  skipStreak: 0,
  lastGenerationMs: null,
  avgGenerationMs: null,
  generationCount: 0,
  lastGeneratedText: null,
  lastPostedText: null,
  lastPostedAt: null,
  updatedAt: Date.now(),
};

function updatePhase(phase, patch = {}) {
  updateStatus({
    phase,
    phaseAt: Date.now(),
    ...patch,
  });
}

function startRunRecord(tickId, snapshotSummary) {
  currentRun = {
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
  if (!currentRun) return;
  currentRun = {
    ...currentRun,
    ...patch,
  };
}

function finalizeRunRecord({ outcome, reason, errors } = {}) {
  if (!currentRun) return;
  const endedAt = Date.now();
  const finalized = {
    ...currentRun,
    outcome: outcome ?? currentRun.outcome,
    reason: reason ?? currentRun.reason,
    errors: errors ?? currentRun.errors ?? null,
    endedAt,
    durationMs: Math.max(0, endedAt - Number(currentRun.startedAt || endedAt)),
  };
  runHistory = [...runHistory.slice(-(MAX_RUN_HISTORY - 1)), finalized];
  currentRun = null;
}

function isAdminSocket(socket) {
  if (!socket) return false;
  const role = getRole(socket);
  return isAdminRole(role);
}

function emitStatusToSocket(socket) {
  if (!socket || !isAdminSocket(socket)) return;
  socket.emit('llm:state', buildAdminState(status, runHistory));
}

function emitStatusToAdmins() {
  const payload = buildAdminState(status, runHistory);
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
  if (JSON.stringify(next) === JSON.stringify(status)) {
    return;
  }
  status = next;
  emitStatusToAdmins();
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

function defaultTickDelayMs() {
  return frequencyMs + Math.floor(Math.random() * (JITTER_MS + 1));
}

function scheduleNextTick(delayMs = defaultTickDelayMs()) {
  const safeDelay = Math.max(0, Number.isFinite(delayMs) ? Math.floor(delayMs) : defaultTickDelayMs());
  const nextRunAt = Date.now() + safeDelay;
  updateStatus({ nextRunAt });
  timer = setTimeout(runTick, safeDelay);
}

function wakeForDriverActivity() {
  if (inFlight) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  scheduleNextTick(0);
}

async function runTick() {
  let nextDelayMs = defaultTickDelayMs();
  tickCount += 1;
  const tickId = tickCount;
  updatePhase('tick_started', {
    tickCount,
    inFlight: true,
    currentRunId: tickId,
    lastTickAt: Date.now(),
    lastError: null,
    lastErrorDetails: null,
  });
  if (inFlight) {
    logger.info('Commentary tick skipped; previous tick still running', { tickId });
    updatePhase('idle', {
      inFlight: false,
      currentRunId: null,
      lastOutcome: 'skipped',
      lastReason: 'previous tick still running',
    });
    scheduleNextTick(nextDelayMs);
    return;
  }
  inFlight = true;
  try {
    const snapshot = snapshotEngine.buildSnapshot();
    const snapshotSummary = {
      activeDrivers: snapshot?.run_meta?.active_driver_count || 0,
      rovers: snapshot?.current_snapshot?.rovers?.length || 0,
      chatMessages: (snapshot?.event_stream || []).filter((event) => event?.type === 'chat').length,
      drivingRovers: snapshot?.run_meta?.driving_rovers || [],
      eventCount: snapshot?.event_stream?.length || 0,
    };
    logger.info('Commentary tick started', {
      tickId,
      ...snapshotSummary,
    });
    startRunRecord(tickId, snapshotSummary);
    patchCurrentRun({
      phase: 'snapshot_ready',
      summary: snapshotSummary,
      input: {
        ...(currentRun?.input || {}),
        infoSnapshot: snapshot,
      },
    });
    updatePhase('snapshot_ready', {
      lastSnapshotSummary: snapshotSummary,
      lastInfoSnapshot: snapshot,
    });
    const systemPrompt = await readSystemPrompt();
    const snapshotForSend = snapshotEngine.refreshFinalSnapshotForSend(snapshot);
    const modelMessages = buildModelMessages(systemPrompt, snapshotForSend);
    const modelInputAt = Date.now();
    patchCurrentRun({
      phase: 'input_ready',
      input: {
        ...(currentRun?.input || {}),
        systemPrompt,
        infoSnapshot: snapshotForSend,
        modelMessages,
        modelInputAt,
      },
    });
    updatePhase('awaiting_model_output', {
      lastModelMessages: modelMessages,
      lastModelInputAt: modelInputAt,
      lastModelInputTickId: tickId,
      lastInfoSnapshot: snapshotForSend,
      lastModelRawOutput: null,
      lastModelOutputAt: null,
      lastModelOutputTickId: null,
      lastReason: 'awaiting model output',
    });
    const generationStartMs = Date.now();
    const modelResult = await generateCommentary(modelMessages);
    const generationMs = Math.max(0, Date.now() - generationStartMs);
    generationCount += 1;
    generationTotalMs += generationMs;
    const avgGenerationMs = Math.round(generationTotalMs / generationCount);
    const modelOutputAt = Date.now();
    patchCurrentRun({
      phase: 'output_received',
      output: {
        ...(currentRun?.output || {}),
        raw: modelResult?.raw || '',
        normalized: modelResult?.normalized || null,
        modelOutputAt,
      },
    });
    updatePhase('output_received', {
      lastModelRawOutput: modelResult?.raw || '',
      lastModelOutputAt: modelOutputAt,
      lastModelOutputTickId: tickId,
      lastGenerationMs: generationMs,
      avgGenerationMs,
      generationCount,
    });
    const text = modelResult?.normalized;
    if (!text) {
      logger.info('Commentary tick produced SKIP/empty output', { tickId });
      skipStreak += 1;
      patchCurrentRun({
        phase: 'decision_skip',
        outcome: 'skipped',
        reason: modelResult?.raw?.trim() ? 'model returned SKIP' : 'model returned empty',
      });
      updatePhase('decision_skip', {
        lastOutcome: 'skipped',
        lastReason: modelResult?.raw?.trim() ? 'model returned SKIP' : 'model returned empty',
        skipStreak,
        lastGeneratedText: null,
      });
      finalizeRunRecord({
        outcome: 'skipped',
        reason: modelResult?.raw?.trim() ? 'model returned SKIP' : 'model returned empty',
      });
      // Immediate retry after model skip.
      nextDelayMs = 0;
      return;
    }
    updatePhase('decision_post', {
      lastGeneratedText: text,
    });
    const recentBotMessages = getRecentMessages(120, { includeSystem: true })
      .filter((entry) => Number(entry?.ts) >= contextResetAt)
      .filter((entry) => entry?.system)
      .slice(-Math.max(3, MAX_BOT_MESSAGES));
    const duplicateKey = normalizeDuplicateKey(text);
    const duplicate = recentBotMessages.some(
      (entry) => normalizeDuplicateKey(entry?.text) === duplicateKey,
    );
    if (duplicate) {
      logger.info('Commentary tick skipped duplicate output', { tickId, text });
      skipStreak += 1;
      patchCurrentRun({
        phase: 'decision_skip',
        outcome: 'skipped',
        reason: 'duplicate text',
      });
      updatePhase('decision_skip', {
        lastOutcome: 'skipped',
        lastReason: 'duplicate text',
        skipStreak,
      });
      finalizeRunRecord({
        outcome: 'skipped',
        reason: 'duplicate text',
      });
      // Immediate retry after a skip outcome.
      nextDelayMs = 0;
      return;
    }
    sendSystemMessage(text);
    logger.info('Commentary message posted', { tickId, text });
    skipStreak = 0;
    patchCurrentRun({
      phase: 'posted',
      outcome: 'posted',
      reason: null,
      output: {
        ...(currentRun?.output || {}),
        posted: text,
        postedAt: Date.now(),
      },
    });
    updatePhase('posted', {
      lastOutcome: 'posted',
      lastReason: null,
      skipStreak,
      lastPostedText: text,
      lastPostedAt: Date.now(),
    });
    nextDelayMs = Math.max(nextDelayMs, POST_COOLDOWN_MS);
    finalizeRunRecord({
      outcome: 'posted',
      reason: null,
    });
  } catch (err) {
    const failure = buildFailureInfo(err);
    logger.warn('Commentary tick failed', {
      tickId,
      reason: failure.reason,
      error: failure.message,
      details: failure.details,
    });
    patchCurrentRun({
      phase: 'failed',
      outcome: 'failed',
      reason: failure.reason,
      errors: {
        message: failure.message,
        details: failure.details,
      },
    });
    updatePhase('failed', {
      lastOutcome: 'failed',
      lastReason: failure.reason,
      lastError: failure.message,
      lastErrorDetails: failure.details,
      lastFailedAt: Date.now(),
    });
    finalizeRunRecord({
      outcome: 'failed',
      reason: failure.reason,
      errors: {
        message: failure.message,
        details: failure.details,
      },
    });
  } finally {
    inFlight = false;
    updatePhase('idle', {
      inFlight: false,
      currentRunId: null,
    });
    scheduleNextTick(nextDelayMs);
  }
}

function start() {
  if (!enabled) {
    logger.info('LLM commentary disabled');
    updatePhase('disabled', {
      running: false,
      lastOutcome: 'disabled',
      lastReason: 'llmCommentary.enabled is false',
    });
    return;
  }
  if (!model || !ollamaUrl) {
    logger.warn('LLM commentary disabled; model or ollamaUrl missing');
    updatePhase('disabled', {
      running: false,
      lastOutcome: 'disabled',
      lastReason: 'model or ollama server missing',
    });
    return;
  }
  logger.info('LLM commentary enabled', { model, ollamaUrl, frequencyMs, promptPath: PROMPT_PATH });
  updatePhase('idle', {
    running: true,
    lastOutcome: 'running',
    lastReason: null,
  });
  runTick();
}

io.on('connection', (socket) => {
  emitStatusToSocket(socket);
  socket.on('llm:control', ({ controls } = {}, cb = () => {}) => {
    if (!isAdminSocket(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    const command = controls?.action || null;
    if (command === 'clearHistory') {
      clearRuntimeHistory();
      cb({ success: true, state: buildAdminState(status, runHistory) });
      return;
    }
    cb({ error: 'Unknown llm control action' });
  });
});

roleEvents.on('change', ({ socket }) => {
  emitStatusToSocket(socket);
});

roverManager.managerEvents.on('sensor', snapshotEngine.onSensorEvent);
roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
  if (action === 'removed' && roverId) {
    snapshotEngine.removeRover(roverId);
  }
});
roverManager.managerEvents.on('driver', ({ action } = {}) => {
  if (action === 'add') {
    wakeForDriverActivity();
  }
});

start();
