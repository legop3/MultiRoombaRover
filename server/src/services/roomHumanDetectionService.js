const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const logger = require('../globals/logger').child('roomHumanDetection');
const io = require('../globals/io');
const { loadConfig } = require('../helpers/configLoader');
const { roomCameraStreamEvents } = require('./roomCameraSnapshotService');
const roverManager = require('./roverManager');
const { issueCommand } = require('./commandService');
const { publishEvent } = require('./eventBus');
const { sendAlert } = require('./alertService');
const { getMode, MODES } = require('./modeManager');
const { isAdmin } = require('./roleService');

const config = loadConfig();
const visionConfig = config.vision?.humanDetection || {};

const runtime = {
  enabled: Boolean(visionConfig.enabled),
  confidenceThreshold: Number.isFinite(Number(visionConfig.confidenceThreshold))
    ? Number(visionConfig.confidenceThreshold)
    : 0.55,
  ttsDelayMs: Number.isFinite(Number(visionConfig.ttsDelayMs)) ? Number(visionConfig.ttsDelayMs) : 30000,
  discordDelayMs: Number.isFinite(Number(visionConfig.discordDelayMs)) ? Number(visionConfig.discordDelayMs) : 60000,
  clearWindowMs: Number.isFinite(Number(visionConfig.clearWindowMs)) ? Number(visionConfig.clearWindowMs) : 3000,
  cooldownMs: Number.isFinite(Number(visionConfig.cooldownMs)) ? Number(visionConfig.cooldownMs) : 15 * 60 * 1000,
  maxInferenceFpsPerCamera: Number.isFinite(Number(visionConfig.maxInferenceFpsPerCamera))
    ? Math.max(0.25, Number(visionConfig.maxInferenceFpsPerCamera))
    : 3,
};

const TTS_TEXT = 'human detected in room, alerting soon';
const workerScript = path.join(__dirname, '..', '..', 'scripts', 'human_detector_worker.py');
const pythonCandidates = [
  process.env.VISION_PYTHON,
  '/opt/multiroomba-vision/.venv/bin/python3',
  'python3',
].filter(Boolean);

const cameraState = new Map(); // cameraId -> { inflight,lastInferAt,lastResultAt,lastPositiveAt,lastConfidence,error }
const history = []; // up to 80 recent events

let worker = null;
let workerReady = false;
let workerPython = null;
let workerRestartCount = 0;
let reqSeq = 1;

let lastAnyPositiveAt = null;
let episodeStartAt = null;
let ttsSentThisEpisode = false;
let discordSentThisEpisode = false;
let latestPositiveFrame = null; // { cameraId, confidence, ts, buffer }
let cooldownUntil = 0;
let hasClearedSinceLastDiscord = true;
let lastDiscordAlertAt = null;
let lastDiscordAlertMeta = null;

function getInferenceIntervalMs() {
  return Math.max(100, Math.round(1000 / Math.max(0.25, Number(runtime.maxInferenceFpsPerCamera) || 3)));
}

function pushHistory(type, detail = {}) {
  history.push({ ts: Date.now(), type, detail });
  while (history.length > 80) history.shift();
}

function isDetectionActiveMode() {
  const mode = getMode();
  return mode !== MODES.ADMIN && mode !== MODES.LOCKDOWN;
}

function ensureCameraState(cameraId) {
  if (!cameraState.has(cameraId)) {
    cameraState.set(cameraId, {
      inflight: false,
      lastInferAt: 0,
      lastResultAt: 0,
      lastPositiveAt: 0,
      lastConfidence: 0,
      error: null,
    });
  }
  return cameraState.get(cameraId);
}

function markCleared(now, reason = 'clear_window') {
  if (episodeStartAt == null) return;
  episodeStartAt = null;
  ttsSentThisEpisode = false;
  discordSentThisEpisode = false;
  lastAnyPositiveAt = null;
  latestPositiveFrame = null;
  hasClearedSinceLastDiscord = true;
  pushHistory('episode.cleared', { reason });
  logger.info('Human detection episode cleared', { now, reason });
}

function sendTtsToNonPrivateRovers() {
  const roster = roverManager.getRoster();
  let sent = 0;
  roster.forEach((entry) => {
    if (entry?.private?.enabled) return;
    try {
      issueCommand(String(entry.id), {
        type: 'tts',
        tts: {
          text: TTS_TEXT,
          speak: true,
        },
      });
      sent += 1;
    } catch (err) {
      logger.warn('Failed to send human-alert TTS', { roverId: entry?.id, error: err.message });
    }
  });
  sendAlert({
    color: '#f0b651',
    title: 'Human Detection',
    message:
      sent > 0
        ? `Person detected; announced on ${sent} rover(s).`
        : 'Person detected; no non-private rover available.',
  });
  publishEvent({
    source: 'roomHumanDetection',
    type: 'vision.humanTtsSent',
    payload: {
      text: TTS_TEXT,
      roverCount: sent,
      ts: Date.now(),
    },
  });
  pushHistory('tts.sent', { roverCount: sent });
}

function sendDiscordDetectionAlert(now, options = {}) {
  const payload = {
    message: options.message || 'Human detected in room cameras.',
    detectedAt: now,
    confidence: latestPositiveFrame?.confidence || null,
    cameraId: latestPositiveFrame?.cameraId || null,
    imageBase64: latestPositiveFrame?.buffer ? latestPositiveFrame.buffer.toString('base64') : null,
  };
  publishEvent({
    source: 'roomHumanDetection',
    type: 'vision.humanDetected',
    payload,
  });
  sendAlert({
    color: '#e53935',
    title: 'Human Detection',
    message: 'Human presence persisted; Discord alert sent.',
  });
  lastDiscordAlertAt = now;
  lastDiscordAlertMeta = {
    cameraId: payload.cameraId,
    confidence: payload.confidence,
    detectedAt: payload.detectedAt,
  };
  pushHistory('discord.sent', {
    cameraId: payload.cameraId,
    confidence: payload.confidence,
  });
}

function buildState(now = Date.now()) {
  const mode = getMode();
  const modeActive = isDetectionActiveMode();
  const humanPresent = episodeStartAt != null;
  const elapsed = humanPresent ? Math.max(0, now - episodeStartAt) : 0;
  const timeToTtsMs = humanPresent && !ttsSentThisEpisode ? Math.max(0, runtime.ttsDelayMs - elapsed) : 0;
  const timeToDiscordMs = humanPresent && !discordSentThisEpisode ? Math.max(0, runtime.discordDelayMs - elapsed) : 0;
  const cooldownRemainingMs = Math.max(0, cooldownUntil - now);
  const cameras = Array.from(cameraState.entries()).map(([cameraId, state]) => ({
    cameraId,
    inflight: Boolean(state.inflight),
    lastInferAt: state.lastInferAt || null,
    lastResultAt: state.lastResultAt || null,
    lastPositiveAt: state.lastPositiveAt || null,
    lastConfidence: state.lastConfidence || 0,
    error: state.error || null,
  }));
  cameras.sort((a, b) => String(a.cameraId).localeCompare(String(b.cameraId)));
  return {
    enabled: runtime.enabled,
    mode,
    modeActive,
    workerReady,
    workerRunning: Boolean(worker && !worker.killed),
    workerPython,
    workerScript,
    workerRestartCount,
    config: { ...runtime },
    episode: {
      humanPresent,
      startAt: episodeStartAt,
      lastAnyPositiveAt,
      ttsSentThisEpisode,
      discordSentThisEpisode,
      timeToTtsMs,
      timeToDiscordMs,
      cooldownUntil,
      cooldownRemainingMs,
      hasClearedSinceLastDiscord,
    },
    latestPositive: latestPositiveFrame
      ? {
          cameraId: latestPositiveFrame.cameraId,
          confidence: latestPositiveFrame.confidence,
          ts: latestPositiveFrame.ts,
        }
      : null,
    lastDiscordAlertAt,
    lastDiscordAlertMeta,
    cameras,
    history: history.slice(),
    updatedAt: now,
  };
}

function emitStateToAdmins() {
  const payload = buildState();
  io.sockets.sockets.forEach((socket) => {
    if (!isAdmin(socket)) return;
    socket.emit('vision:human:state', payload);
  });
}

function evaluateEpisode(now = Date.now()) {
  if (!runtime.enabled) {
    markCleared(now, 'disabled');
    return;
  }
  if (!isDetectionActiveMode()) {
    markCleared(now, 'mode_gate');
    return;
  }
  if (episodeStartAt != null && lastAnyPositiveAt != null && now - lastAnyPositiveAt > runtime.clearWindowMs) {
    markCleared(now, 'clear_window');
    return;
  }
  if (episodeStartAt == null) return;
  const elapsed = Math.max(0, now - episodeStartAt);
  if (!ttsSentThisEpisode && elapsed >= runtime.ttsDelayMs) {
    sendTtsToNonPrivateRovers();
    ttsSentThisEpisode = true;
  }
  if (discordSentThisEpisode) return;
  if (elapsed < runtime.discordDelayMs) return;
  if (!hasClearedSinceLastDiscord) return;
  if (now < cooldownUntil) return;
  sendDiscordDetectionAlert(now);
  discordSentThisEpisode = true;
  hasClearedSinceLastDiscord = false;
  cooldownUntil = now + runtime.cooldownMs;
}

function handleWorkerMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    logger.warn('Invalid vision worker JSON', { error: err.message });
    return;
  }
  if (msg?.type === 'ready') {
    workerReady = true;
    pushHistory('worker.ready');
    logger.info('Vision worker ready');
    emitStateToAdmins();
    return;
  }
  const cameraId = String(msg?.cameraId || '');
  if (!cameraId) return;
  const state = ensureCameraState(cameraId);
  state.inflight = false;
  state.lastResultAt = Date.now();
  if (!msg.ok) {
    state.error = msg.error || 'worker error';
    logger.warn('Vision inference failed', { cameraId, error: state.error });
    evaluateEpisode(Date.now());
    emitStateToAdmins();
    return;
  }
  state.error = null;
  state.lastConfidence = Number(msg.bestConfidence || 0);
  if (msg.personDetected) {
    const now = Number(msg.ts) || Date.now();
    state.lastPositiveAt = now;
    lastAnyPositiveAt = now;
    if (episodeStartAt == null) {
      episodeStartAt = now;
      ttsSentThisEpisode = false;
      discordSentThisEpisode = false;
      pushHistory('episode.started', { cameraId });
      logger.info('Human detection episode started', { cameraId, now });
    }
    let buffer = null;
    try {
      if (msg.annotatedBase64) {
        buffer = Buffer.from(String(msg.annotatedBase64), 'base64');
      }
    } catch (err) {
      logger.warn('Failed to decode annotated frame from worker', { cameraId, error: err.message });
    }
    if (buffer) {
      latestPositiveFrame = {
        cameraId,
        confidence: state.lastConfidence,
        ts: now,
        buffer,
      };
    }
  }
  evaluateEpisode(Number(msg.ts) || Date.now());
  emitStateToAdmins();
}

function startWorker() {
  for (const pythonBin of pythonCandidates) {
    try {
      const proc = spawn(pythonBin, [workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      worker = proc;
      workerReady = false;
      workerPython = pythonBin;
      readline.createInterface({ input: proc.stdout }).on('line', handleWorkerMessage);
      proc.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (!text) return;
        logger.warn('Vision worker stderr', { text: text.slice(0, 300) });
      });
      proc.on('exit', (code, signal) => {
        logger.warn('Vision worker exited', { code, signal });
        worker = null;
        workerReady = false;
        workerRestartCount += 1;
        pushHistory('worker.exit', { code, signal });
        emitStateToAdmins();
      });
      logger.info('Vision worker started', { pythonBin, workerScript });
      pushHistory('worker.started', { pythonBin });
      return true;
    } catch (err) {
      logger.warn('Failed to spawn vision worker candidate', { pythonBin, error: err.message });
    }
  }
  return false;
}

function submitFrame(cameraId, buffer, ts = Date.now()) {
  if (!runtime.enabled) return;
  if (!worker || !workerReady) return;
  const state = ensureCameraState(cameraId);
  const now = Date.now();
  if (state.inflight) return;
  if (now - state.lastInferAt < getInferenceIntervalMs()) return;
  state.inflight = true;
  state.lastInferAt = now;
  const payload = {
    reqId: `r${reqSeq++}`,
    cameraId: String(cameraId),
    ts: Number(ts) || now,
    confidenceThreshold: runtime.confidenceThreshold,
    imageBase64: buffer.toString('base64'),
  };
  try {
    worker.stdin.write(`${JSON.stringify(payload)}\n`);
  } catch (err) {
    state.inflight = false;
    state.error = err.message;
    logger.warn('Failed writing frame to vision worker', { cameraId, error: err.message });
  }
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function updateRuntimeConfig(patch = {}) {
  const prevEnabled = runtime.enabled;
  runtime.enabled = typeof patch.enabled === 'boolean' ? patch.enabled : runtime.enabled;
  runtime.confidenceThreshold = clampNumber(patch.confidenceThreshold, 0, 1, runtime.confidenceThreshold);
  runtime.ttsDelayMs = clampNumber(patch.ttsDelayMs, 1000, 60 * 60 * 1000, runtime.ttsDelayMs);
  runtime.discordDelayMs = clampNumber(
    patch.discordDelayMs,
    runtime.ttsDelayMs,
    2 * 60 * 60 * 1000,
    runtime.discordDelayMs,
  );
  runtime.clearWindowMs = clampNumber(patch.clearWindowMs, 250, 60 * 1000, runtime.clearWindowMs);
  runtime.cooldownMs = clampNumber(patch.cooldownMs, 0, 12 * 60 * 60 * 1000, runtime.cooldownMs);
  runtime.maxInferenceFpsPerCamera = clampNumber(
    patch.maxInferenceFpsPerCamera,
    0.25,
    30,
    runtime.maxInferenceFpsPerCamera,
  );
  if (prevEnabled && !runtime.enabled) {
    markCleared(Date.now(), 'disabled');
  }
  pushHistory('config.updated', { patch });
}

if (!startWorker()) {
  logger.error('Room human detection worker failed to start; detection unavailable until restart');
  pushHistory('worker.unavailable');
}

roomCameraStreamEvents.on('frame', ({ id, buffer, ts }) => {
  if (!runtime.enabled) return;
  if (!isDetectionActiveMode()) return;
  if (!id || !buffer) return;
  submitFrame(String(id), buffer, ts);
});

setInterval(() => {
  evaluateEpisode(Date.now());
  emitStateToAdmins();
}, 1000);

io.on('connection', (socket) => {
  socket.on('vision:human:getState', (_, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      cb({ ok: true, state: buildState() });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('vision:human:updateConfig', ({ config: patch } = {}, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      updateRuntimeConfig(patch || {});
      emitStateToAdmins();
      cb({ ok: true, state: buildState() });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('vision:human:testTts', (_, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      sendTtsToNonPrivateRovers();
      emitStateToAdmins();
      cb({ ok: true, state: buildState() });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('vision:human:testDiscord', (_, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      sendDiscordDetectionAlert(Date.now(), { message: 'Human detection test alert.' });
      emitStateToAdmins();
      cb({ ok: true, state: buildState() });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('vision:human:clear', (_, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      markCleared(Date.now(), 'manual_clear');
      emitStateToAdmins();
      cb({ ok: true, state: buildState() });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  if (isAdmin(socket)) {
    socket.emit('vision:human:state', buildState());
  }
});

logger.info('Room human detection service started', {
  ...runtime,
  workerScript,
});

module.exports = {
  getRoomHumanDetectionState: () => buildState(),
};
