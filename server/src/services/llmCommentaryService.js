const fsp = require('fs/promises');
const path = require('path');
const { Ollama } = require('ollama');
const io = require('../globals/io');
const logger = require('../globals/logger').child('llmCommentary');
const { loadConfig } = require('../helpers/configLoader');
const { getRole, roleEvents } = require('./roleService');
const roverManager = require('./roverManager');
const { getActiveDrivers } = require('./turnService');
const { getNickname } = require('./nicknameService');
const { getRecentMessages, sendSystemMessage } = require('./chatService');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'commentary_system.txt');
const DEFAULT_FREQUENCY_MS = 120000;
const MIN_FREQUENCY_MS = 15000;
const JITTER_MS = 30000;
const MAX_ROVERS = 6;
const MAX_CHAT_MESSAGES = 6;
const MAX_BOT_MESSAGES = 1;
const MAX_OUTPUT_CHARS = 140;
const SKIP_TOKEN = 'SKIP';
const ACTIVITY_WINDOW_MS = 30000;
const ACTIVITY_BUCKET_MS = 1000;

const config = loadConfig();
const commentaryConfig = config.llmCommentary || {};
const enabled = Boolean(commentaryConfig.enabled);
const ollamaUrl = String(
  commentaryConfig.ollamaUrl || commentaryConfig.ollamaServer || '',
).trim();
const model = String(commentaryConfig.model || '').trim();
const timezone = String(config.timezone || 'UTC');
const ollamaClient = ollamaUrl ? new Ollama({ host: ollamaUrl }) : null;

let timer = null;
let inFlight = false;
let tickCount = 0;
let contextResetAt = Date.now();
let clearCount = 0;
const roverActivity = new Map(); // roverId -> { buckets: Map(bucketTs -> { distanceMm, turnDeg, bumps }), bumpLeftActive, bumpRightActive }

function normalizeFrequencyMs(value) {
  if (!Number.isFinite(value)) return DEFAULT_FREQUENCY_MS;
  // If frequency is configured as a small integer, treat it as seconds for convenience.
  const parsed = value > 0 && value < 1000 ? value * 1000 : value;
  return Math.max(MIN_FREQUENCY_MS, Math.floor(parsed));
}

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
  lastError: null,
  lastPromptReadAt: null,
  lastPromptChars: 0,
  lastSystemPrompt: null,
  lastInfoSnapshot: null,
  lastSnapshotSummary: null,
  lastClearedAt: contextResetAt,
  clearCount,
  lastGeneratedText: null,
  lastPostedText: null,
  lastPostedAt: null,
  updatedAt: Date.now(),
};

function isAdminSocket(socket) {
  if (!socket) return false;
  const role = getRole(socket);
  return role === 'admin' || role === 'lockdown' || role === 'lockdown-admin';
}

function emitStatusToSocket(socket) {
  if (!socket || !isAdminSocket(socket)) return;
  socket.emit('llmCommentary:status', status);
}

function emitStatusToAdmins() {
  io.sockets.sockets.forEach((socket) => {
    if (!isAdminSocket(socket)) return;
    socket.emit('llmCommentary:status', status);
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

function localTimeString(date, tz) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function pruneActivityBuckets(state, nowMs) {
  if (!state?.buckets) return;
  const minTs = nowMs - ACTIVITY_WINDOW_MS;
  state.buckets.forEach((_, bucketTs) => {
    if (bucketTs < minTs) {
      state.buckets.delete(bucketTs);
    }
  });
}

function upsertActivityState(roverId) {
  if (!roverActivity.has(roverId)) {
    roverActivity.set(roverId, {
      buckets: new Map(),
      bumpLeftActive: false,
      bumpRightActive: false,
    });
  }
  return roverActivity.get(roverId);
}

function onSensorEvent({ roverId, sensors } = {}) {
  if (!roverId || !sensors) return;
  const nowMs = Date.now();
  const bucketTs = Math.floor(nowMs / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS;
  const state = upsertActivityState(String(roverId));
  pruneActivityBuckets(state, nowMs);
  if (!state.buckets.has(bucketTs)) {
    state.buckets.set(bucketTs, { distanceMm: 0, turnDeg: 0, bumps: 0 });
  }
  const bucket = state.buckets.get(bucketTs);
  bucket.distanceMm += Math.abs(Number(sensors.distanceMm) || 0);
  bucket.turnDeg += Math.abs(Number(sensors.angleDeg) || 0);
  const bumpLeftNow = Boolean(sensors?.bumpsAndWheelDrops?.bumpLeft);
  const bumpRightNow = Boolean(sensors?.bumpsAndWheelDrops?.bumpRight);
  if (bumpLeftNow && !state.bumpLeftActive) {
    bucket.bumps += 0.5;
  }
  if (bumpRightNow && !state.bumpRightActive) {
    bucket.bumps += 0.5;
  }
  state.bumpLeftActive = bumpLeftNow;
  state.bumpRightActive = bumpRightNow;
}

function getActivity30s(roverId, nowMs = Date.now()) {
  const state = roverActivity.get(String(roverId));
  if (!state) {
    return { distance_m: 0, turn_deg: 0, bumps: 0 };
  }
  pruneActivityBuckets(state, nowMs);
  let distanceMm = 0;
  let turnDeg = 0;
  let bumps = 0;
  state.buckets.forEach((bucket) => {
    distanceMm += bucket.distanceMm;
    turnDeg += bucket.turnDeg;
    bumps += bucket.bumps;
  });
  return {
    distance_m: Math.round((distanceMm / 1000) * 10) / 10,
    turn_deg: Math.round(turnDeg),
    bumps: Math.round(bumps * 10) / 10,
  };
}

function clearRuntimeHistory() {
  contextResetAt = Date.now();
  clearCount += 1;
  roverActivity.clear();
  updateStatus({
    lastClearedAt: contextResetAt,
    clearCount,
    lastInfoSnapshot: null,
    lastSnapshotSummary: null,
    lastGeneratedText: null,
    lastPostedText: null,
    lastPostedAt: null,
    lastError: null,
    lastOutcome: 'cleared',
    lastReason: 'admin requested clear history',
  });
}

function isChargingFromSensors(sensors = {}) {
  const label = String(sensors?.chargingState?.label || '').toLowerCase();
  if (label === 'waiting' || label === 'full charging' || label === 'trickle charging') {
    return true;
  }
  const code = sensors?.chargingState?.code;
  return code === 2 || code === 3 || code === 4;
}

function resolveDriverNickname(socketId) {
  if (!socketId) return null;
  const socket = io.sockets.sockets.get(socketId);
  return getNickname(socket) || socket?.data?.user?.username || socketId.slice(0, 6);
}

function collectActiveDriverEntries() {
  const fromTurns = Object.entries(getActiveDrivers()).filter(([, socketId]) => Boolean(socketId));
  if (fromTurns.length > 0) {
    return fromTurns;
  }
  const fallback = [];
  roverManager.rovers.forEach((record, roverId) => {
    const socketId = record?.drivers?.values?.().next?.().value || null;
    if (socketId) {
      fallback.push([String(roverId), socketId]);
    }
  });
  return fallback;
}

function buildSnapshot() {
  const now = new Date();
  const activeDrivers = getActiveDrivers();
  const driverEntries = collectActiveDriverEntries();
  if (driverEntries.length === 0) {
    return null;
  }

  const roster = roverManager.getRoster().slice(0, MAX_ROVERS);
  const rovers = roster.map((entry) => {
    const roverId = String(entry.id);
    const record = roverManager.rovers.get(roverId);
    const sensors = record?.lastSensor?.decoded || {};
    const batteryState = entry.batteryState || null;
    const driverSocketId = activeDrivers[roverId] || null;
    const activity30s = getActivity30s(roverId, now.getTime());
    const charging = isChargingFromSensors(sensors);
    const docked = Boolean(sensors?.chargingSources?.homeBase);
    const isMoving = activity30s.distance_m > 0.1 || activity30s.turn_deg > 20;
    let statusTag = 'idle';
    if (charging) {
      statusTag = 'charging';
    } else if (docked) {
      statusTag = 'docked';
    } else if (driverSocketId && isMoving) {
      statusTag = 'driving';
    } else if (driverSocketId) {
      statusTag = 'active-idle';
    }
    return {
      id: roverId,
      name: entry.name || roverId,
      driver_nickname: driverSocketId ? resolveDriverNickname(driverSocketId) : null,
      docked,
      charging,
      battery_low: Boolean(batteryState?.warnActive || batteryState?.urgentActive),
      activity_30s: activity30s,
      status_tag: statusTag,
    };
  });

  const chatRecent = getRecentMessages(60, { includeSystem: false })
    .filter((entry) => Number(entry?.ts) >= contextResetAt)
    .slice(-MAX_CHAT_MESSAGES)
    .map((entry) => ({
    ts_iso: new Date(entry.ts).toISOString(),
    nickname: entry.nickname || entry.socketId?.slice(0, 6) || 'unknown',
    text: entry.text || '',
    }));

  const botRecent = getRecentMessages(80, { includeSystem: true })
    .filter((entry) => Number(entry?.ts) >= contextResetAt)
    .filter((entry) => entry?.system)
    .slice(-MAX_BOT_MESSAGES)
    .map((entry) => ({
      ts_iso: new Date(entry.ts).toISOString(),
      text: entry.text || '',
    }));

  return {
    now: {
      iso: now.toISOString(),
      local: localTimeString(now, timezone),
      timezone,
      unix_ms: now.getTime(),
    },
    activity: {
      active_driver_count: driverEntries.length,
      driving_rovers: driverEntries.map(([roverId]) => String(roverId)),
    },
    rovers,
    chat_recent: chatRecent,
    your_last_message: botRecent,
  };
}

function normalizeCommentary(rawText) {
  if (typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === SKIP_TOKEN) return null;
  const firstLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  if (firstLine.toUpperCase() === SKIP_TOKEN) return null;
  const normalized = firstLine.replace(/\s+/g, ' ');
  if (normalized.length <= MAX_OUTPUT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_OUTPUT_CHARS - 3)}...`;
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

async function generateCommentary(systemPrompt, snapshot) {
  if (!ollamaClient) {
    throw new Error('Ollama client unavailable');
  }
  const payload = await ollamaClient.chat({
    model,
    stream: false,
    keep_alive: -1,
    options: {
      temperature: 0.35,
      top_p: 0.8,
      num_predict: 80,
    },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(snapshot) },
    ],
  });
  return normalizeCommentary(payload?.message?.content);
}

function scheduleNextTick() {
  const delay = frequencyMs + Math.floor(Math.random() * (JITTER_MS + 1));
  const nextRunAt = Date.now() + delay;
  updateStatus({ nextRunAt });
  timer = setTimeout(runTick, delay);
}

async function runTick() {
  tickCount += 1;
  const tickId = tickCount;
  updateStatus({
    tickCount,
    inFlight: true,
    lastTickAt: Date.now(),
    lastError: null,
  });
  if (inFlight) {
    logger.info('Commentary tick skipped; previous tick still running', { tickId });
    updateStatus({
      inFlight: false,
      lastOutcome: 'skipped',
      lastReason: 'previous tick still running',
    });
    scheduleNextTick();
    return;
  }
  inFlight = true;
  try {
    const snapshot = buildSnapshot();
    if (!snapshot) {
      logger.info('Commentary tick skipped; no active drivers', { tickId });
      updateStatus({
        lastOutcome: 'skipped',
        lastReason: 'no active drivers',
        inFlight: false,
        lastSnapshotSummary: {
          activeDrivers: 0,
          rovers: roverManager.getRoster().length,
          chatMessages: 0,
        },
      });
      return;
    }
    const snapshotSummary = {
      activeDrivers: snapshot.activity.active_driver_count,
      rovers: snapshot.rovers.length,
      chatMessages: snapshot.chat_recent.length,
      drivingRovers: snapshot.activity.driving_rovers,
    };
    logger.info('Commentary tick started', {
      tickId,
      ...snapshotSummary,
    });
    updateStatus({
      lastSnapshotSummary: snapshotSummary,
      lastInfoSnapshot: snapshot,
    });
    const systemPrompt = await readSystemPrompt();
    const text = await generateCommentary(systemPrompt, snapshot);
    if (!text) {
      logger.info('Commentary tick produced SKIP/empty output', { tickId });
      updateStatus({
        lastOutcome: 'skipped',
        lastReason: 'model returned SKIP/empty',
        lastGeneratedText: null,
      });
      return;
    }
    updateStatus({
      lastGeneratedText: text,
    });
    const recentBotMessages = getRecentMessages(80, { includeSystem: true })
      .filter((entry) => Number(entry?.ts) >= contextResetAt)
      .filter((entry) => entry?.system)
      .slice(-MAX_BOT_MESSAGES);
    const duplicate = recentBotMessages.some(
      (entry) => String(entry?.text || '').trim().toLowerCase() === text.toLowerCase(),
    );
    if (duplicate) {
      logger.info('Commentary tick skipped duplicate output', { tickId, text });
      updateStatus({
        lastOutcome: 'skipped',
        lastReason: 'duplicate text',
      });
      return;
    }
    sendSystemMessage(text);
    logger.info('Commentary message posted', { tickId, text });
    updateStatus({
      lastOutcome: 'posted',
      lastReason: null,
      lastPostedText: text,
      lastPostedAt: Date.now(),
    });
  } catch (err) {
    logger.warn('Commentary tick failed', { tickId, error: err.message });
    updateStatus({
      lastOutcome: 'failed',
      lastReason: 'exception',
      lastError: err.message,
    });
  } finally {
    inFlight = false;
    updateStatus({
      inFlight: false,
    });
    scheduleNextTick();
  }
}

function start() {
  if (!enabled) {
    logger.info('LLM commentary disabled');
    updateStatus({
      running: false,
      lastOutcome: 'disabled',
      lastReason: 'llmCommentary.enabled is false',
    });
    return;
  }
  if (!model || !ollamaUrl) {
    logger.warn('LLM commentary disabled; model or ollamaUrl missing');
    updateStatus({
      running: false,
      lastOutcome: 'disabled',
      lastReason: 'model or ollama server missing',
    });
    return;
  }
  logger.info('LLM commentary enabled', { model, ollamaUrl, frequencyMs, promptPath: PROMPT_PATH });
  updateStatus({
    running: true,
    lastOutcome: 'running',
    lastReason: null,
  });
  runTick();
}

io.on('connection', (socket) => {
  emitStatusToSocket(socket);
  socket.on('llm:control', ({ action } = {}, cb = () => {}) => {
    if (!isAdminSocket(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    if (action === 'clearHistory') {
      clearRuntimeHistory();
      cb({ success: true, status });
      return;
    }
    cb({ error: 'Unknown llm control action' });
  });
});

roleEvents.on('change', ({ socket }) => {
  emitStatusToSocket(socket);
});

roverManager.managerEvents.on('sensor', onSensorEvent);
roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
  if (action === 'removed' && roverId) {
    roverActivity.delete(String(roverId));
  }
});

start();
