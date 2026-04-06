const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const logger = require('../globals/logger').child('roomHumanDetection');
const { loadConfig } = require('../helpers/configLoader');
const { roomCameraStreamEvents } = require('./roomCameraSnapshotService');
const roverManager = require('./roverManager');
const { issueCommand } = require('./commandService');
const { publishEvent } = require('./eventBus');
const { sendAlert } = require('./alertService');
const { getMode, MODES } = require('./modeManager');

const config = loadConfig();
const visionConfig = config.vision?.humanDetection || {};
const enabled = Boolean(visionConfig.enabled);

if (!enabled) {
  logger.info('Room human detection disabled via config');
  return;
}

const CONFIDENCE_THRESHOLD = Number.isFinite(Number(visionConfig.confidenceThreshold))
  ? Number(visionConfig.confidenceThreshold)
  : 0.55;
const TTS_DELAY_MS = Number.isFinite(Number(visionConfig.ttsDelayMs))
  ? Number(visionConfig.ttsDelayMs)
  : 30000;
const DISCORD_DELAY_MS = Number.isFinite(Number(visionConfig.discordDelayMs))
  ? Number(visionConfig.discordDelayMs)
  : 60000;
const CLEAR_WINDOW_MS = Number.isFinite(Number(visionConfig.clearWindowMs))
  ? Number(visionConfig.clearWindowMs)
  : 3000;
const COOLDOWN_MS = Number.isFinite(Number(visionConfig.cooldownMs))
  ? Number(visionConfig.cooldownMs)
  : 15 * 60 * 1000;
const MAX_INFERENCE_FPS = Number.isFinite(Number(visionConfig.maxInferenceFpsPerCamera))
  ? Math.max(0.25, Number(visionConfig.maxInferenceFpsPerCamera))
  : 3;
const TTS_TEXT = 'human detected in room, alerting soon';

const workerScript = path.join(__dirname, '..', '..', 'scripts', 'human_detector_worker.py');
const pythonCandidates = [process.env.VISION_PYTHON, '/opt/multiroomba-vision/.venv/bin/python3', 'python3'].filter(Boolean);
const inferenceIntervalMs = Math.max(100, Math.round(1000 / MAX_INFERENCE_FPS));

const cameraState = new Map(); // cameraId -> { inflight,lastInferAt,lastResultAt,lastPositiveAt,lastConfidence,error }
let worker = null;
let workerReady = false;
let reqSeq = 1;

let lastAnyPositiveAt = null;
let episodeStartAt = null;
let ttsSentThisEpisode = false;
let discordSentThisEpisode = false;
let latestPositiveFrame = null; // { cameraId, confidence, ts, buffer }
let cooldownUntil = 0;
let hasClearedSinceLastDiscord = true;

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

function markCleared(now) {
  if (episodeStartAt == null) return;
  episodeStartAt = null;
  ttsSentThisEpisode = false;
  discordSentThisEpisode = false;
  lastAnyPositiveAt = null;
  latestPositiveFrame = null;
  hasClearedSinceLastDiscord = true;
  logger.info('Human detection episode cleared', { now });
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
    message: sent > 0 ? `Person detected; announced on ${sent} rover(s).` : 'Person detected; no non-private rover available.',
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
}

function sendDiscordDetectionAlert(now) {
  const payload = {
    message: 'Human detected in room cameras.',
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
}

function evaluateEpisode(now = Date.now()) {
  if (!isDetectionActiveMode()) {
    markCleared(now);
    return;
  }
  if (episodeStartAt != null && lastAnyPositiveAt != null && now - lastAnyPositiveAt > CLEAR_WINDOW_MS) {
    markCleared(now);
    return;
  }
  if (episodeStartAt == null) return;
  const elapsed = Math.max(0, now - episodeStartAt);
  if (!ttsSentThisEpisode && elapsed >= TTS_DELAY_MS) {
    sendTtsToNonPrivateRovers();
    ttsSentThisEpisode = true;
  }
  if (discordSentThisEpisode) return;
  if (elapsed < DISCORD_DELAY_MS) return;
  if (!hasClearedSinceLastDiscord) return;
  if (now < cooldownUntil) return;
  sendDiscordDetectionAlert(now);
  discordSentThisEpisode = true;
  hasClearedSinceLastDiscord = false;
  cooldownUntil = now + COOLDOWN_MS;
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
    logger.info('Vision worker ready');
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
}

function startWorker() {
  for (const pythonBin of pythonCandidates) {
    try {
      const proc = spawn(pythonBin, [workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      worker = proc;
      workerReady = false;
      readline
        .createInterface({ input: proc.stdout })
        .on('line', handleWorkerMessage);
      proc.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (!text) return;
        logger.warn('Vision worker stderr', { text: text.slice(0, 300) });
      });
      proc.on('exit', (code, signal) => {
        logger.warn('Vision worker exited', { code, signal });
        worker = null;
        workerReady = false;
      });
      logger.info('Vision worker started', { pythonBin, workerScript });
      return true;
    } catch (err) {
      logger.warn('Failed to spawn vision worker candidate', { pythonBin, error: err.message });
    }
  }
  return false;
}

function submitFrame(cameraId, buffer, ts = Date.now()) {
  if (!worker || !workerReady) return;
  const state = ensureCameraState(cameraId);
  const now = Date.now();
  if (state.inflight) return;
  if (now - state.lastInferAt < inferenceIntervalMs) return;
  state.inflight = true;
  state.lastInferAt = now;
  const payload = {
    reqId: `r${reqSeq++}`,
    cameraId: String(cameraId),
    ts: Number(ts) || now,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
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

if (!startWorker()) {
  logger.error('Room human detection disabled; failed to start Python worker');
  return;
}

roomCameraStreamEvents.on('frame', ({ id, buffer, ts }) => {
  if (!isDetectionActiveMode()) return;
  if (!id || !buffer) return;
  submitFrame(String(id), buffer, ts);
});

setInterval(() => {
  evaluateEpisode(Date.now());
}, 1000);

logger.info('Room human detection service started', {
  confidenceThreshold: CONFIDENCE_THRESHOLD,
  ttsDelayMs: TTS_DELAY_MS,
  discordDelayMs: DISCORD_DELAY_MS,
  clearWindowMs: CLEAR_WINDOW_MS,
  cooldownMs: COOLDOWN_MS,
  maxInferenceFpsPerCamera: MAX_INFERENCE_FPS,
});

module.exports = {};
