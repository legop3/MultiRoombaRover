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
const DEFAULT_FREQUENCY_MS = 0;
const MIN_FREQUENCY_MS = 0;
const JITTER_MS = 0;
const MAX_ROVERS = 6;
const MAX_CHAT_MESSAGES = 4;
const MAX_BOT_MESSAGES = 1;
const SKIP_TOKEN = 'SKIP';
const ACTIVITY_WINDOW_MS = 30000;
const ACTIVITY_BUCKET_MS = 1000;
const SELF_TALK_WINDOW_MS = 30 * 60 * 1000;
const MAX_CONTEXT_EVENTS = 10;

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
const roverActivity = new Map(); // roverId -> { buckets: Map(bucketTs -> { distanceMm, turnDeg, bumps }), bumpLeftActive, bumpRightActive }
const lastRoverStateById = new Map(); // roverId -> compact rover state used as prev_state

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
  lastModelMessages: null,
  lastModelRawOutput: null,
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
  skipStreak = 0;
  generationCount = 0;
  generationTotalMs = 0;
  roverActivity.clear();
  lastRoverStateById.clear();
  updateStatus({
    lastClearedAt: contextResetAt,
    clearCount,
    skipStreak,
    lastGenerationMs: null,
    avgGenerationMs: null,
    generationCount,
    lastInfoSnapshot: null,
    lastModelMessages: null,
    lastModelRawOutput: null,
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

function detectMessageTopic(text = '') {
  const value = String(text).toLowerCase();
  if (!value.trim()) return 'none';
  if (/\b(bump|hit|bonk|crash|slam|collision)\b/.test(value)) return 'bumps';
  if (/\b(wheel.?drop|wheels?.*off.?ground|picked up|lifted)\b/.test(value)) return 'wheels_off_ground';
  if (/\b(dock|docked|undock|charger|charging)\b/.test(value)) return 'dock_charge';
  if (/\b(battery|low power|power)\b/.test(value)) return 'battery';
  if (/\b(chat|everyone|people|crowd)\b/.test(value)) return 'chat';
  if (/\b(move|driv|turn|spin|rolling)\b/.test(value)) return 'movement';
  return 'general';
}

function buildLastMessageFocus(lastBotMessage, rovers = []) {
  if (!lastBotMessage) return null;
  const text = String(lastBotMessage.text || '');
  const textLower = text.toLowerCase();
  let roverId = null;
  for (const rover of rovers) {
    const id = String(rover?.id || '').toLowerCase();
    const name = String(rover?.name || '').toLowerCase();
    if ((id && textLower.includes(id)) || (name && textLower.includes(name))) {
      roverId = rover.id;
      break;
    }
  }
  return {
    rover_id: roverId,
    topic: detectMessageTopic(text),
  };
}

function compactRoverForContext(rover) {
  if (!rover) return null;
  return {
    id: rover.id,
    status_tag: rover.status_tag,
    battery_low: rover.battery_low,
    docked: rover.docked,
    charging: rover.charging,
    wheels_off_ground: rover.wheels_off_ground,
    activity_30s: rover.activity_30s,
  };
}

function buildSnapshot() {
  const now = new Date();
  const nowMs = now.getTime();
  const activeDrivers = getActiveDrivers();
  const driverEntries = collectActiveDriverEntries();

  const roster = roverManager.getRoster().slice(0, MAX_ROVERS);
  const nextRoverStateById = new Map();
  const rovers = roster.map((entry) => {
    const roverId = String(entry.id);
    const record = roverManager.rovers.get(roverId);
    const sensors = record?.lastSensor?.decoded || {};
    const batteryState = entry.batteryState || null;
    const driverSocketId = activeDrivers[roverId] || null;
    const wheelsOffGround = Boolean(
      sensors?.bumpsAndWheelDrops?.wheelDropLeft && sensors?.bumpsAndWheelDrops?.wheelDropRight,
    );
    const activity30s = getActivity30s(roverId, nowMs);
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
    const rover = {
      id: roverId,
      name: entry.name || roverId,
      driver_nickname: driverSocketId ? resolveDriverNickname(driverSocketId) : null,
      docked,
      charging,
      wheels_off_ground: wheelsOffGround,
      battery_low: Boolean(batteryState?.warnActive || batteryState?.urgentActive),
      activity_30s: activity30s,
      status_tag: statusTag,
    };
    const prev = lastRoverStateById.get(roverId) || null;
    const nextState = {
      driver_nickname: rover.driver_nickname,
      docked: rover.docked,
      charging: rover.charging,
      wheels_off_ground: rover.wheels_off_ground,
      battery_low: rover.battery_low,
      activity_30s: rover.activity_30s,
      status_tag: rover.status_tag,
    };
    nextRoverStateById.set(roverId, nextState);
    rover.prev_state = prev;
    return rover;
  });
  lastRoverStateById.clear();
  nextRoverStateById.forEach((value, roverId) => {
    lastRoverStateById.set(roverId, value);
  });
  const roverById = new Map(rovers.map((rover) => [String(rover.id), rover]));
  const allRecentMessages = getRecentMessages(300, { includeSystem: true })
    .filter((entry) => Number(entry?.ts) >= contextResetAt);
  const chatRecent = allRecentMessages
    .filter((entry) => !entry?.system)
    .slice(-MAX_CHAT_MESSAGES)
    .map((entry) => ({
      nickname: entry.nickname || entry.socketId?.slice(0, 6) || 'unknown',
      text: entry.text || '',
    }));

  const botRecentWindow = allRecentMessages
    .filter((entry) => Number(entry?.ts) >= contextResetAt)
    .filter((entry) => entry?.system);
  const lastBotMessage = botRecentWindow.length ? botRecentWindow[botRecentWindow.length - 1] : null;
  const botRecent30m = botRecentWindow.filter(
    (entry) => nowMs - Number(entry?.ts || 0) <= SELF_TALK_WINDOW_MS,
  );

  const eventStream = allRecentMessages.slice(-MAX_CONTEXT_EVENTS).map((entry) => {
    if (entry?.system) {
      return {
        type: 'bot',
        nickname: entry.nickname || 'Rover Bot',
        text: entry.text || '',
      };
    }
    const roverId = entry?.roverId ? String(entry.roverId) : null;
    const rover = roverId ? roverById.get(roverId) : null;
    return {
      type: 'chat',
      nickname: entry.nickname || entry.socketId?.slice(0, 6) || 'unknown',
      text: entry.text || '',
      rover_id: roverId,
      rover_ctx: compactRoverForContext(rover),
    };
  });
  const hasRecentChat = eventStream.some((event) => event.type === 'chat');
  if (!hasRecentChat) {
    eventStream.push({
      type: 'snapshot',
      reason: 'chat_quiet',
      rovers,
    });
  }

  const currentSnapshot = {
    rovers,
  };
  if (!hasRecentChat) {
    currentSnapshot.chat_recent = chatRecent;
  }

  return {
    run_meta: {
      version: 'commentary_v2',
      self_talk_recent_30m: botRecent30m.length,
      skip_streak: skipStreak,
      last_message_focus: buildLastMessageFocus(lastBotMessage, rovers),
      active_driver_count: driverEntries.length,
      driving_rovers: driverEntries.map(([roverId]) => String(roverId)),
    },
    event_stream: eventStream,
    current_snapshot: currentSnapshot,
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
  return firstLine.replace(/\s+/g, ' ');
}

function parseModelOutput(rawContent) {
  const raw = typeof rawContent === 'string' ? rawContent : '';
  const normalized = normalizeCommentary(raw);
  return {
    raw,
    normalized,
    skipped: normalized == null,
  };
}

function formatRunMetaMessage(runMeta = {}) {
  const focus = runMeta?.last_message_focus || null;
  const focusText = focus
    ? `topic=${focus.topic || 'none'} rover=${focus.rover_id || 'none'}`
    : 'none';
  const drivingRovers = Array.isArray(runMeta?.driving_rovers) && runMeta.driving_rovers.length
    ? runMeta.driving_rovers.join(', ')
    : 'none';
  return [
    'RUN META',
    `- active drivers: ${Number(runMeta?.active_driver_count) || 0}`,
    `- driving rovers: ${drivingRovers}`,
    `- bot posts last 30m: ${Number(runMeta?.self_talk_recent_30m) || 0}`,
    `- current skip streak: ${Number(runMeta?.skip_streak) || 0}`,
    `- last bot focus: ${focusText}`,
  ].join('\n');
}

function formatRoverCtx(ctx) {
  if (!ctx || typeof ctx !== 'object') return 'none';
  const activity = ctx.activity_30s || {};
  return `status=${ctx.status_tag || 'unknown'} battery_low=${Boolean(ctx.battery_low)} wheels_off_ground=${Boolean(ctx.wheels_off_ground)} docked=${Boolean(ctx.docked)} charging=${Boolean(ctx.charging)} move30=${Number(activity.distance_m) || 0}m turn30=${Number(activity.turn_deg) || 0}deg bumps30=${Number(activity.bumps) || 0}`;
}

function formatChatEventMessage(event) {
  return [
    'CHAT',
    `nick: ${event.nickname || 'unknown'}`,
    `text: ${event.text || ''}`,
    `rover: ${event.rover_id || 'none'}`,
    `rover_now: ${formatRoverCtx(event.rover_ctx)}`,
  ].join('\n');
}

function formatRoverSnapshotLine(rover = {}) {
  const activity = rover.activity_30s || {};
  return `${rover.id || 'unknown'}: driver=${rover.driver_nickname || 'none'} status=${rover.status_tag || 'unknown'} battery_low=${Boolean(rover.battery_low)} wheels_off_ground=${Boolean(rover.wheels_off_ground)} docked=${Boolean(rover.docked)} charging=${Boolean(rover.charging)} move30=${Number(activity.distance_m) || 0}m turn30=${Number(activity.turn_deg) || 0}deg bumps30=${Number(activity.bumps) || 0}`;
}

function formatSnapshotMessage(event) {
  const rovers = Array.isArray(event?.rovers) ? event.rovers : [];
  const lines = ['SNAPSHOT', `reason: ${event?.reason || 'none'}`];
  rovers.forEach((rover) => {
    lines.push(formatRoverSnapshotLine(rover));
  });
  return lines.join('\n');
}

function formatSnapshotFinalMessage(currentSnapshot = {}) {
  const rovers = Array.isArray(currentSnapshot?.rovers) ? currentSnapshot.rovers : [];
  const lines = ['SNAPSHOT FINAL'];
  rovers.forEach((rover) => {
    lines.push(formatRoverSnapshotLine(rover));
  });
  if (Array.isArray(currentSnapshot?.chat_recent) && currentSnapshot.chat_recent.length) {
    lines.push('chat_recent:');
    currentSnapshot.chat_recent.forEach((entry) => {
      lines.push(`- ${entry.nickname || 'unknown'}: ${entry.text || ''}`);
    });
  }
  return lines.join('\n');
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
  const messages = [];
  messages.push({ role: 'system', content: systemPrompt });
  messages.push({
    role: 'user',
    content: formatRunMetaMessage(snapshot?.run_meta || {}),
  });
  const timeline = Array.isArray(snapshot?.event_stream) ? snapshot.event_stream : [];
  timeline.forEach((event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'bot') {
      const text = String(event.text || '').trim();
      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
      return;
    }
    if (event.type === 'chat') {
      messages.push({
        role: 'user',
        content: formatChatEventMessage(event),
      });
      return;
    }
    if (event.type === 'snapshot') {
      messages.push({
        role: 'user',
        content: formatSnapshotMessage(event),
      });
    }
  });
  // Always end with a full rover snapshot user message.
  messages.push({
    role: 'user',
    content: formatSnapshotFinalMessage(snapshot?.current_snapshot || {}),
  });
  updateStatus({
    lastModelMessages: messages,
  });

  const payload = await ollamaClient.chat({
    model,
    stream: false,
    keep_alive: -1,
    options: {
      temperature: 0.45,
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
    scheduleNextTick(nextDelayMs);
    return;
  }
  inFlight = true;
  try {
    const snapshot = buildSnapshot();
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
    updateStatus({
      lastSnapshotSummary: snapshotSummary,
      lastInfoSnapshot: snapshot,
    });
    const systemPrompt = await readSystemPrompt();
    const generationStartMs = Date.now();
    const modelResult = await generateCommentary(systemPrompt, snapshot);
    const generationMs = Math.max(0, Date.now() - generationStartMs);
    generationCount += 1;
    generationTotalMs += generationMs;
    const avgGenerationMs = Math.round(generationTotalMs / generationCount);
    updateStatus({
      lastModelRawOutput: modelResult?.raw || '',
      lastGenerationMs: generationMs,
      avgGenerationMs,
      generationCount,
    });
    const text = modelResult?.normalized;
    if (!text) {
      logger.info('Commentary tick produced SKIP/empty output', { tickId });
      skipStreak += 1;
      updateStatus({
        lastOutcome: 'skipped',
        lastReason: modelResult?.raw?.trim() ? 'model returned SKIP' : 'model returned empty',
        skipStreak,
        lastGeneratedText: null,
      });
      // Immediate retry after model skip.
      nextDelayMs = 0;
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
      skipStreak += 1;
      updateStatus({
        lastOutcome: 'skipped',
        lastReason: 'duplicate text',
        skipStreak,
      });
      // Immediate retry after a skip outcome.
      nextDelayMs = 0;
      return;
    }
    sendSystemMessage(text);
    logger.info('Commentary message posted', { tickId, text });
    skipStreak = 0;
    updateStatus({
      lastOutcome: 'posted',
      lastReason: null,
      skipStreak,
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
    scheduleNextTick(nextDelayMs);
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
roverManager.managerEvents.on('driver', ({ action } = {}) => {
  if (action === 'add') {
    wakeForDriverActivity();
  }
});

start();
