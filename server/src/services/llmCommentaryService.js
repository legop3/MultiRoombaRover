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
const ACTIVITY_WINDOW_MS = 60000;
const ACTIVITY_BUCKET_MS = 1000;
const ACTIVITY_SCORE_WINDOW_MS = 30000;
const SELF_TALK_WINDOW_MS = 30 * 60 * 1000;
const MAX_CONTEXT_EVENTS = 15;
const MAX_RUN_HISTORY = 30;
const MAX_ROVER_EVENTS = 400;
const POST_COOLDOWN_MS = 10000;

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
const roverActivity = new Map(); // roverId -> { buckets: Map(bucketTs -> { distanceMm, turnDeg, bumps }), bumpLeftActive, bumpRightActive }
const roverMajorEvents = []; // [{ ts, type: 'event', event_type, rover_id, driver_nickname, summary }]
const lastSensorFlagsByRover = new Map(); // roverId -> { docked, charging, battery_low, wheels_off_ground }
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

function buildAdminState() {
  return {
    runtime: {
      running: status.running,
      inFlight: status.inFlight,
      phase: status.phase,
      phaseAt: status.phaseAt,
      currentRunId: status.currentRunId,
      tickCount: status.tickCount,
      lastTickAt: status.lastTickAt,
      nextRunAt: status.nextRunAt,
      outcome: status.lastOutcome,
      reason: status.lastReason,
    },
    counters: {
      clearCount: status.clearCount,
      skipStreak: status.skipStreak,
      promptChars: status.lastPromptChars,
      snapshotSummary: status.lastSnapshotSummary,
    },
    timings: {
      lastGenerationMs: status.lastGenerationMs,
      avgGenerationMs: status.avgGenerationMs,
      generationCount: status.generationCount,
    },
    input: {
      promptPath: status.promptPath,
      systemPrompt: status.lastSystemPrompt,
      infoSnapshot: status.lastInfoSnapshot,
      modelMessages: status.lastModelMessages,
      modelInputAt: status.lastModelInputAt,
      modelInputTickId: status.lastModelInputTickId,
    },
    output: {
      raw: status.lastModelRawOutput,
      generated: status.lastGeneratedText,
      posted: status.lastPostedText,
      postedAt: status.lastPostedAt,
      modelOutputAt: status.lastModelOutputAt,
      modelOutputTickId: status.lastModelOutputTickId,
    },
    errors: {
      message: status.lastError,
      details: status.lastErrorDetails,
      failedAt: status.lastFailedAt,
    },
    history: runHistory,
    debug: {
      status,
    },
    controls: {
      supportedActions: ['clearHistory'],
    },
  };
}

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
  return role === 'admin' || role === 'lockdown' || role === 'lockdown-admin';
}

function emitStatusToSocket(socket) {
  if (!socket || !isAdminSocket(socket)) return;
  socket.emit('llm:state', buildAdminState());
}

function emitStatusToAdmins() {
  const payload = buildAdminState();
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

function pushRoverMajorEvent(event) {
  roverMajorEvents.push(event);
  if (roverMajorEvents.length > MAX_ROVER_EVENTS) {
    roverMajorEvents.shift();
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

function onSensorEvent({ roverId, sensors, batteryState } = {}) {
  if (!roverId || !sensors) return;
  if (!roverManager.canReplayRoverId(roverId)) return;
  const nowMs = Date.now();
  const dockedNow = Boolean(sensors?.chargingSources?.homeBase);
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
  if (!dockedNow) {
    if (bumpLeftNow && !state.bumpLeftActive) {
      bucket.bumps += 0.5;
    }
    if (bumpRightNow && !state.bumpRightActive) {
      bucket.bumps += 0.5;
    }
  }
  state.bumpLeftActive = bumpLeftNow;
  state.bumpRightActive = bumpRightNow;

  const roverKey = String(roverId);
  const activeDrivers = getActiveDrivers();
  const driverSocketId = activeDrivers[roverKey] || null;
  const driverNickname = driverSocketId ? resolveDriverNickname(driverSocketId) : null;
  const docked = dockedNow;
  const charging = isChargingFromSensors(sensors);
  const wheelsOffGround = Boolean(
    sensors?.bumpsAndWheelDrops?.wheelDropLeft && sensors?.bumpsAndWheelDrops?.wheelDropRight,
  );
  const batteryLow = Boolean(batteryState?.warnActive || batteryState?.urgentActive);
  const prevFlags = lastSensorFlagsByRover.get(roverKey) || null;
  const nextFlags = {
    docked,
    charging,
    battery_low: batteryLow,
    wheels_off_ground: wheelsOffGround,
  };
  if (prevFlags) {
    if (prevFlags.docked !== nextFlags.docked) {
      pushRoverMajorEvent({
        ts: nowMs,
        type: 'event',
        event_type: nextFlags.docked ? 'rover_docked' : 'rover_undocked',
        rover_id: roverKey,
        driver_nickname: driverNickname,
        summary: nextFlags.docked ? 'transitioned to docked' : 'transitioned to undocked',
      });
    }
    if (prevFlags.battery_low !== nextFlags.battery_low) {
      pushRoverMajorEvent({
        ts: nowMs,
        type: 'event',
        event_type: 'battery_low_changed',
        rover_id: roverKey,
        driver_nickname: driverNickname,
        summary: nextFlags.battery_low ? 'battery_low became true' : 'battery_low became false',
      });
    }
  }
  lastSensorFlagsByRover.set(roverKey, nextFlags);
}

function getActivity30s(roverId, nowMs = Date.now()) {
  return getActivityWindow(roverId, ACTIVITY_SCORE_WINDOW_MS, 0, nowMs);
}

function getActivityWindow(roverId, windowMs, offsetMs = 0, nowMs = Date.now()) {
  const state = roverActivity.get(String(roverId));
  if (!state) {
    return { distance_m: 0, turn_deg: 0, bumps: 0 };
  }
  pruneActivityBuckets(state, nowMs);
  const windowStart = nowMs - offsetMs - windowMs;
  const windowEnd = nowMs - offsetMs;
  let distanceMm = 0;
  let turnDeg = 0;
  let bumps = 0;
  state.buckets.forEach((bucket, bucketTs) => {
    if (bucketTs < windowStart || bucketTs > windowEnd) return;
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

function computeBaseActivityScore(activity = {}) {
  const distanceScore = Math.min(45, Math.max(0, Number(activity.distance_m) || 0) * 25);
  const turnScore = Math.min(30, Math.max(0, Number(activity.turn_deg) || 0) / 12);
  const bumpScore = Math.min(25, Math.max(0, Number(activity.bumps) || 0) * 12);
  return Math.round(Math.min(100, distanceScore + turnScore + bumpScore));
}

function computeActivityBand(score) {
  if (score >= 75) return 'intense';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  if (score >= 8) return 'low';
  return 'idle';
}

function computeActivityTrend(currentBaseScore, previousBaseScore) {
  const delta = Number(currentBaseScore || 0) - Number(previousBaseScore || 0);
  if (delta >= 12) return 'rising';
  if (delta <= -12) return 'falling';
  return 'steady';
}

function clearRuntimeHistory() {
  contextResetAt = Date.now();
  clearCount += 1;
  skipStreak = 0;
  generationCount = 0;
  generationTotalMs = 0;
  runHistory = [];
  currentRun = null;
  roverMajorEvents.length = 0;
  lastSensorFlagsByRover.clear();
  roverActivity.clear();
  lastRoverStateById.clear();
  updateStatus({
    lastClearedAt: contextResetAt,
    clearCount,
    skipStreak,
    phase: 'idle',
    phaseAt: Date.now(),
    currentRunId: null,
    lastGenerationMs: null,
    avgGenerationMs: null,
    generationCount,
    lastInfoSnapshot: null,
    lastModelMessages: null,
    lastModelInputAt: null,
    lastModelInputTickId: null,
    lastModelRawOutput: null,
    lastModelOutputAt: null,
    lastModelOutputTickId: null,
    lastSnapshotSummary: null,
    lastGeneratedText: null,
    lastPostedText: null,
    lastPostedAt: null,
    lastError: null,
    lastErrorDetails: null,
    lastFailedAt: null,
    lastOutcome: 'cleared',
    lastReason: 'admin requested clear history',
  });
}

function buildFailureInfo(err) {
  const details = {};
  if (err && typeof err === 'object') {
    if (err.name) details.name = String(err.name);
    if (err.code != null) details.code = String(err.code);
    if (err.errno != null) details.errno = String(err.errno);
    if (err.type) details.type = String(err.type);
    if (err.status != null) details.status = Number(err.status);
    if (err.statusCode != null) details.statusCode = Number(err.statusCode);
    if (err.status_code != null) details.status_code = Number(err.status_code);
    if (err.error) details.error = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
    if (err.cause) {
      if (typeof err.cause === 'string') {
        details.cause = err.cause;
      } else if (typeof err.cause === 'object') {
        details.cause = {
          name: err.cause.name || null,
          message: err.cause.message || null,
          code: err.cause.code || null,
          status: err.cause.status ?? err.cause.statusCode ?? null,
        };
      }
    }
    if (err.response && typeof err.response === 'object') {
      const response = {};
      if (err.response.status != null) response.status = Number(err.response.status);
      if (err.response.statusText) response.statusText = String(err.response.statusText);
      if (err.response.url) response.url = String(err.response.url);
      if (Object.keys(response).length) {
        details.response = response;
      }
    }
  }

  const message =
    (err && typeof err === 'object' && typeof err.message === 'string' && err.message.trim()) ||
    details.error ||
    String(err || 'Unknown error');

  const reasonParts = [];
  if (details.name) reasonParts.push(details.name);
  const code = details.code || details.errno || details.type;
  if (code) reasonParts.push(String(code));
  const status =
    details.status ??
    details.statusCode ??
    details.status_code ??
    details.response?.status ??
    null;
  if (status != null) reasonParts.push(`status ${status}`);
  const reason = reasonParts.length ? reasonParts.join(' | ') : 'exception';

  return { reason, message, details: Object.keys(details).length ? details : null };
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
    contact_state: rover.contact_state || 'clear',
    hazard_state: rover.hazard_state || 'normal',
    mobility_state: rover.mobility_state || 'normal',
    activity_score: rover.activity_score ?? 0,
    activity_band: rover.activity_band || 'idle',
    activity_trend: rover.activity_trend || 'steady',
  };
}

function deriveContactState(sensors = {}, activity30s = {}, docked = false) {
  if (docked) return 'clear';
  const bumps = Number(activity30s?.bumps) || 0;
  const hasBump = bumps >= 0.5 || sensors?.bumpsAndWheelDrops?.bumpLeft || sensors?.bumpsAndWheelDrops?.bumpRight;
  if (hasBump) return 'bumps_recent';
  const light = sensors?.lightBumper || {};
  const wallBrush =
    Boolean(sensors?.wall) ||
    Boolean(light.left || light.frontLeft || light.centerLeft || light.centerRight || light.frontRight || light.right);
  if (wallBrush) return 'wall_brush';
  return 'clear';
}

function deriveHazardState(sensors = {}, docked = false) {
  if (docked) return 'normal';
  if (Boolean(sensors?.virtualWall)) return 'virtual_wall_seen';
  if (
    Boolean(sensors?.cliffLeft) ||
    Boolean(sensors?.cliffFrontLeft) ||
    Boolean(sensors?.cliffFrontRight) ||
    Boolean(sensors?.cliffRight)
  ) {
    return 'cliff_alert';
  }
  return 'normal';
}

function deriveMobilityState(sensors = {}, wheelsOffGround = false) {
  if (wheelsOffGround) return 'wheels_off_ground';
  return 'normal';
}

function buildRoversNow(nowMs = Date.now()) {
  const activeDrivers = getActiveDrivers();
  const roster = roverManager
    .getRoster()
    .filter((entry) => roverManager.canReplayRoverId(entry.id))
    .slice(0, MAX_ROVERS);
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
    const previousActivity30s = getActivityWindow(
      roverId,
      ACTIVITY_SCORE_WINDOW_MS,
      ACTIVITY_SCORE_WINDOW_MS,
      nowMs,
    );
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
      contact_state: deriveContactState(sensors, activity30s, docked),
      hazard_state: deriveHazardState(sensors, docked),
      mobility_state: deriveMobilityState(sensors, wheelsOffGround),
    };
    const currentBaseScore = computeBaseActivityScore(activity30s);
    const previousBaseScore = computeBaseActivityScore(previousActivity30s);
    let activityScore = currentBaseScore;
    if (rover.contact_state === 'wall_brush') activityScore += 6;
    if (rover.contact_state === 'bumps_recent') activityScore += 12;
    if (rover.hazard_state !== 'normal') activityScore += 8;
    if (rover.status_tag === 'driving') activityScore += 8;
    if (rover.status_tag === 'active-idle') activityScore += 4;
    if (rover.charging || rover.docked) activityScore -= 25;
    if (rover.wheels_off_ground) activityScore -= 20;
    activityScore = Math.max(0, Math.min(100, Math.round(activityScore)));
    rover.activity_score = activityScore;
    rover.activity_band = computeActivityBand(activityScore);
    rover.activity_trend = computeActivityTrend(currentBaseScore, previousBaseScore);
    const prev = lastRoverStateById.get(roverId) || null;
    const nextState = {
      driver_nickname: rover.driver_nickname,
      docked: rover.docked,
      charging: rover.charging,
      wheels_off_ground: rover.wheels_off_ground,
      battery_low: rover.battery_low,
      activity_30s: rover.activity_30s,
      status_tag: rover.status_tag,
      activity_score: rover.activity_score,
      activity_band: rover.activity_band,
      activity_trend: rover.activity_trend,
    };
    nextRoverStateById.set(roverId, nextState);
    rover.prev_state = prev;
    return rover;
  });
  lastRoverStateById.clear();
  nextRoverStateById.forEach((value, roverId) => {
    lastRoverStateById.set(roverId, value);
  });
  return { rovers, activeDrivers, roster };
}

function buildSnapshot() {
  const now = new Date();
  const nowMs = now.getTime();
  const driverEntries = collectActiveDriverEntries();
  const { rovers } = buildRoversNow(nowMs);
  const roverById = new Map(rovers.map((rover) => [String(rover.id), rover]));
  const allRecentMessages = getRecentMessages(300, { includeSystem: true })
    .filter((entry) => Number(entry?.ts) >= contextResetAt)
    .filter((entry) => {
      const roverId = entry?.roverId ? String(entry.roverId) : null;
      if (!roverId) return true;
      return roverManager.canReplayRoverId(roverId);
    });
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

  const roverEvents = roverMajorEvents.filter(
    (entry) =>
      Number(entry?.ts) >= contextResetAt &&
      roverManager.canReplayRoverId(entry?.rover_id || ''),
  );
  const timelineEntries = [
    ...allRecentMessages.map((entry) => ({ ts: Number(entry?.ts || 0), source: 'chat', entry })),
    ...roverEvents.map((entry) => ({ ts: Number(entry?.ts || 0), source: 'event', entry })),
  ]
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_CONTEXT_EVENTS);

  const eventStream = timelineEntries.map(({ source, entry }) => {
    if (source === 'event') {
      return {
        type: 'event',
        event_type: entry.event_type || 'rover_event',
        rover_id: entry.rover_id || null,
        driver_nickname: entry.driver_nickname || null,
        summary: entry.summary || '',
      };
    }
    if (entry?.system) {
      return {
        type: 'bot',
        nickname: entry.nickname || 'Rover Bot',
        text: entry.text || '',
      };
    }
    const roverId = entry?.roverId ? String(entry.roverId) : null;
    const rover = roverId ? roverById.get(roverId) : null;
    const baseCtx = compactRoverForContext(rover) || {};
    const storedCtx = entry?.roverCtx || entry?.rover_ctx || {};
    return {
      type: 'chat',
      nickname: entry.nickname || entry.socketId?.slice(0, 6) || 'unknown',
      text: entry.text || '',
      rover_id: roverId,
      rover_ctx: { ...baseCtx, ...storedCtx },
    };
  });
  const hasRecentChat = eventStream.some((event) => event.type === 'chat');

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

function refreshFinalSnapshotForSend(snapshot) {
  const { rovers } = buildRoversNow(Date.now());
  return {
    ...(snapshot || {}),
    current_snapshot: {
      ...(snapshot?.current_snapshot || {}),
      rovers,
    },
  };
}

function normalizeCommentary(rawText) {
  if (typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  if (/\bSKIP\b/i.test(trimmed)) return null;
  const firstLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  if (/\bSKIP\b/i.test(firstLine)) return null;
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

function normalizeDuplicateKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function encBool(value) {
  return value ? '1' : '0';
}

function encStatus(value) {
  const map = {
    charging: 'charging',
    docked: 'docked',
    driving: 'driving',
    'active-idle': 'active_idle',
    idle: 'idle',
    unknown: 'unknown',
  };
  return map[String(value || 'unknown')] || 'unknown';
}

function encActivityBand(value) {
  const map = {
    idle: 'idle',
    low: 'low',
    medium: 'medium',
    high: 'high',
    intense: 'intense',
  };
  return map[String(value || 'idle')] || 'idle';
}

function encActivityTrend(value) {
  const map = {
    rising: 'rising',
    steady: 'steady',
    falling: 'falling',
  };
  return map[String(value || 'steady')] || 'steady';
}

function formatChatRoverCtx(ctx) {
  if (!ctx || typeof ctx !== 'object') return 'none';
  return `st=${encStatus(ctx.status_tag)} bl=${encBool(Boolean(ctx.battery_low))} dk=${encBool(Boolean(ctx.docked))} ab=${encActivityBand(ctx.activity_band)} at=${encActivityTrend(ctx.activity_trend)}`;
}

function formatChatEventMessage(event) {
  const roverId = event.rover_id || 'none';
  if (roverId === 'none') {
    return [
      'CHAT',
      `n=${event.nickname || 'unknown'} r=none driver=none`,
      `txt: ${event.text || ''}`,
    ].join('\n');
  }
  return [
    'CHAT',
    `n=${event.nickname || 'unknown'} r=${roverId}`,
    `txt: ${event.text || ''}`,
    `rn: ${formatChatRoverCtx(event.rover_ctx)}`,
  ].join('\n');
}

function formatRoverSnapshotLine(rover = {}) {
  return `id=${rover.id || 'unknown'} drv=${rover.driver_nickname || 'none'} st=${encStatus(rover.status_tag)} bl=${encBool(Boolean(rover.battery_low))} dk=${encBool(Boolean(rover.docked))} as=${Number(rover.activity_score) || 0} ab=${encActivityBand(rover.activity_band)} at=${encActivityTrend(rover.activity_trend)}`;
}

function formatEventMessage(event) {
  return [
    'EVENT',
    `e=${event.event_type || 'rover_event'} r=${event.rover_id || 'unknown'} d=${event.driver_nickname || 'none'}`,
    `s: ${event.summary || ''}`,
  ].join('\n');
}

function formatSnapshotMessage(event) {
  const rovers = Array.isArray(event?.rovers) ? event.rovers : [];
  const lines = ['SNAPSHOT', `reason=${event?.reason || 'none'}`];
  rovers.forEach((rover) => {
    lines.push(formatRoverSnapshotLine(rover));
  });
  return lines.join('\n');
}

function formatSnapshotFinalMessage(currentSnapshot = {}, runMeta = {}) {
  const rovers = Array.isArray(currentSnapshot?.rovers) ? currentSnapshot.rovers : [];
  const lines = ['SNAPSHOT FINAL'];
  lines.push(`skip_streak=${Number(runMeta?.skip_streak) || 0}`);
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

function buildModelMessages(systemPrompt, snapshot) {
  const messages = [];
  messages.push({ role: 'system', content: systemPrompt });
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
    if (event.type === 'event') {
      messages.push({
        role: 'user',
        content: formatEventMessage(event),
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
    content: formatSnapshotFinalMessage(snapshot?.current_snapshot || {}, snapshot?.run_meta || {}),
  });
  return messages;
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
    const snapshotForSend = refreshFinalSnapshotForSend(snapshot);
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
      cb({ success: true, state: buildAdminState() });
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
