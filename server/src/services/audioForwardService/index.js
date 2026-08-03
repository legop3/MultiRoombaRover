// audio Forward Service
// Purpose: Composes audio-forward policy, worker engine, and hook wiring into the public service API.
// Scope: Keeps runtime behavior unchanged while making this entrypoint a thin orchestration layer.
const path = require('path');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('audioForwardService');
const { loadConfig } = require('../../helpers/configLoader');
const roverManager = require('../roverManager');
const turnService = require('../turnService');
const { isMuted, isVerified, verificationEvents } = require('../verificationService');
const videoSessions = require('../videoSessions');
const { createAudioForwardPolicy } = require('./policy');
const { createAudioForwardWorkerEngine } = require('./workerEngine');
const { registerAudioForwardHooks } = require('./hooks');
const { registerChargeCompleteSound } = require('./chargeCompleteSound');
const { registerBonkSound } = require('./bonkSound');

const audioForwardEvents = new EventEmitter();
const config = loadConfig();
const audioForwardConfig = config.audioForward || {};
const mediaConfig = config.media || {};
const serviceEnabled = audioForwardConfig.enabled !== false;
const ffmpegBin = audioForwardConfig.ffmpegBin || 'ffmpeg';
const streamSuffix =
  typeof audioForwardConfig.streamSuffix === 'string' && audioForwardConfig.streamSuffix.trim()
    ? audioForwardConfig.streamSuffix.trim()
    : '-fwd';
const runtimeDir = path.resolve(audioForwardConfig.runtimeDir || '/tmp/mrr-audio-forward');
const uploadsDir = path.join(runtimeDir, 'uploads');
const maxUploadBytes = Number.isFinite(audioForwardConfig.maxUploadBytes)
  ? Math.max(256 * 1024, Math.floor(audioForwardConfig.maxUploadBytes))
  : 8 * 1024 * 1024;

const states = new Map(); // roverId -> { state, source, error, startedAt, updatedAt }
const workers = new Map(); // roverId -> worker
const whipOwners = new Map(); // roverId -> socketId

function publishStateChange(roverId) {
  audioForwardEvents.emit('change', { roverId, state: states.get(roverId) || null });
}

function setState(roverId, next = {}) {
  const prev = states.get(roverId) || {};
  const merged = {
    state: next.state || prev.state || 'idle',
    source: Object.prototype.hasOwnProperty.call(next, 'source') ? next.source : prev.source || 'silence',
    error: Object.prototype.hasOwnProperty.call(next, 'error') ? next.error : prev.error || null,
    startedAt: Object.prototype.hasOwnProperty.call(next, 'startedAt') ? next.startedAt : prev.startedAt || null,
    updatedAt: Date.now(),
  };
  states.set(roverId, merged);
  publishStateChange(roverId);
}

function getAudioForwardState() {
  const payload = {};
  states.forEach((entry, roverId) => {
    payload[roverId] = { ...entry };
  });
  return payload;
}

const audioForwardPolicy = createAudioForwardPolicy({
  isVerified,
  isMuted,
  roverManager,
  turnService,
  streamSuffix,
  mediaConfig,
});
const {
  ensureAudioForwardPermission,
  resolveForwardUrl,
  resolveForwardPublishTarget,
  resolveForwardPathId,
  buildWhipUrl,
} = audioForwardPolicy;

const workerEngine = createAudioForwardWorkerEngine({
  logger,
  io,
  roverManager,
  turnService,
  videoSessions,
  serviceEnabled,
  ffmpegBin,
  runtimeDir,
  uploadsDir,
  maxUploadBytes,
  workers,
  whipOwners,
  setState,
  resolveForwardUrl,
  resolveForwardPublishTarget,
  resolveForwardPathId,
});

const {
  ensureWorker,
  stopWorker,
  stopAllWorkers,
  playUploadedAudio,
  playServerAudioFile,
  stopPlayback,
  revokeWhipSessionForRover,
  stopWhipForRover,
  stopOwnedAudioIfUnauthorized,
  startSilenceWriter,
} = workerEngine;

function installShutdownHooks() {
  const shutdown = (signal) => {
    // Audio forwarding owns long-lived ffmpeg publisher/writer pairs. Stop them
    // synchronously on process signals so a systemd restart does not have to
    // wait for orphaned media workers to notice that their parent is gone.
    stopAllWorkers(signal || 'process-exit');
  };

  process.once('exit', () => shutdown('exit'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

installShutdownHooks();

registerAudioForwardHooks({
  io,
  roverManager,
  turnService,
  logger,
  serviceEnabled,
  workers,
  whipOwners,
  ensureWorker,
  stopWorker,
  setState,
  stopOwnedAudioIfUnauthorized,
  stopWhipForRover,
  ensureAudioForwardPermission,
  playUploadedAudio,
  stopPlayback,
  resolveForwardPathId,
  revokeWhipSessionForRover,
  buildWhipUrl,
  videoSessions,
  startSilenceWriter,
  isMuted,
  verificationEvents,
});

registerChargeCompleteSound({
  logger,
  playServerAudioFile,
});

registerBonkSound({
  logger,
  playServerAudioFile,
});

module.exports = {
  getAudioForwardState,
  audioForwardEvents,
};
