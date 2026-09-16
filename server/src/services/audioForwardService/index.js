// audio Forward Service
// Purpose: Composes audio-forward policy, worker engine, and hook wiring into the public service API.
// Scope: Keeps runtime behavior unchanged while making this entrypoint a thin orchestration layer.
const path = require('path');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('audioForwardService');
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const { resolveRuntimePath } = require('../../helpers/dataPaths');
const roverManager = require('../roverManager');
const turnService = require('../turnService');
const { isMuted, isVerified, verificationEvents } = require('../verificationService');
const videoSessions = require('../videoSessions');
const { createAudioForwardPolicy } = require('./policy');
const { createAudioForwardWorkerEngine } = require('./workerEngine');
const { registerAudioForwardHooks } = require('./hooks');
const { registerChargeCompleteSound } = require('./chargeCompleteSound');

const audioForwardEvents = new EventEmitter();
let serviceEnabled = false;
/*
  FIFOs and uploaded clips are disposable, but they are deliberately created
  and managed by this application. A fixed path below SERVER_DATA_DIR keeps the
  Node process from writing to an unrelated host temp directory and prevents a
  configuration value from escaping the server's filesystem boundary.
*/
const runtimeDir = resolveRuntimePath('audio-forward');
const uploadsDir = path.join(runtimeDir, 'uploads');

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

let operations;

function replaceAudioForwardRuntime(fullConfig) {
  operations?.stopAllWorkers('configuration-change');
  const audioForwardConfig = fullConfig.audioForward || {};
  serviceEnabled = Boolean(audioForwardConfig.enabled);
  const streamSuffix = typeof audioForwardConfig.streamSuffix === 'string' && audioForwardConfig.streamSuffix.trim()
    ? audioForwardConfig.streamSuffix.trim()
    : '-fwd';
  const policy = createAudioForwardPolicy({
    isVerified,
    isMuted,
    roverManager,
    turnService,
    streamSuffix,
  });
  const maxUploadBytes = Number.isFinite(audioForwardConfig.maxUploadBytes)
    ? Math.max(256 * 1024, Math.floor(audioForwardConfig.maxUploadBytes))
    : 8 * 1024 * 1024;
  operations = {
    ...policy,
    ...createAudioForwardWorkerEngine({
      logger,
      io,
      roverManager,
      turnService,
      videoSessions,
      serviceEnabled,
      ffmpegBin: audioForwardConfig.ffmpegBin || 'ffmpeg',
      runtimeDir,
      uploadsDir,
      maxUploadBytes,
      workers,
      whipOwners,
      setState,
      resolveForwardUrl: policy.resolveForwardUrl,
      resolveForwardPathId: policy.resolveForwardPathId,
    }),
  };
}

replaceAudioForwardRuntime(loadConfig());

// Stable delegates keep the one-time socket/event registrations below pointed
// at the newest policy and worker engine after audio-forward changes.
const delegate = (name) => (...args) => operations[name](...args);
const ensureWorker = delegate('ensureWorker');
const stopWorker = delegate('stopWorker');
const stopAllWorkers = delegate('stopAllWorkers');
const playUploadedAudio = delegate('playUploadedAudio');
const playServerAudioFile = delegate('playServerAudioFile');
const stopPlayback = delegate('stopPlayback');
const revokeWhipSessionForRover = delegate('revokeWhipSessionForRover');
const stopWhipForRover = delegate('stopWhipForRover');
const stopOwnedAudioIfUnauthorized = delegate('stopOwnedAudioIfUnauthorized');
const startSilenceWriter = delegate('startSilenceWriter');
const ensureAudioForwardPermission = delegate('ensureAudioForwardPermission');
const resolveForwardPathId = delegate('resolveForwardPathId');
const buildWhipUrl = delegate('buildWhipUrl');

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
  isServiceEnabled: () => serviceEnabled,
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

registerConfigurationHandler('audioForward', (_section, _previous, nextConfig) => {
  replaceAudioForwardRuntime(nextConfig);
});

module.exports = {
  getAudioForwardState,
  audioForwardEvents,
};
