// audio Forward Service
// Purpose: Defines the audio Forward Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('audioForwardService');
const { loadConfig } = require('../../helpers/configLoader');
const roverManager = require('../roverManager');
const turnService = require('../turnService');
const { isVerified } = require('../verificationService');
const videoSessions = require('../videoSessions');
const { createAudioForwardPolicy } = require('./policy');
const { registerAudioForwardHooks } = require('./hooks');

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

function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function sanitizeRoverId(roverId) {
  return String(roverId || '').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function sanitizeFileStem(name) {
  return String(name || 'upload')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function extFromUpload(name, mime) {
  const lowerName = String(name || '').toLowerCase();
  const lowerMime = String(mime || '').toLowerCase();
  if (lowerName.endsWith('.mp3') || lowerMime === 'audio/mpeg' || lowerMime === 'audio/mp3') return '.mp3';
  if (lowerName.endsWith('.wav') || lowerMime === 'audio/wav' || lowerMime === 'audio/x-wav') return '.wav';
  if (lowerName.endsWith('.ogg') || lowerMime === 'audio/ogg') return '.ogg';
  throw new Error('Unsupported upload format (allowed: mp3, wav, ogg)');
}

const audioForwardPolicy = createAudioForwardPolicy({
  isVerified,
  roverManager,
  turnService,
  streamSuffix,
  mediaConfig,
});
const {
  ensureAudioForwardPermission,
  resolveForwardUrl,
  resolveForwardPathId,
  buildWhipUrl,
} = audioForwardPolicy;

function ensureFifo(fifoPath) {
  try {
    const stat = fs.statSync(fifoPath);
    if (stat.isFIFO()) return;
    fs.unlinkSync(fifoPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const result = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`mkfifo failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
}


function spawnFfmpeg(roverId, tag, args, options = {}) {
  const proc = spawn(ffmpegBin, args, {
    stdio: [options.captureStdin ? 'pipe' : 'ignore', options.captureStdout ? 'pipe' : 'ignore', 'pipe'],
  });
  proc.stderr?.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    logger.warn(`${tag} stderr`, { roverId, text });
  });
  proc.on('error', (err) => {
    logger.warn(`${tag} spawn error`, { roverId, message: err?.message || String(err) });
  });
  return proc;
}

function stopProc(proc, graceMs = 1200) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    return;
  }
  setTimeout(() => {
    if (!proc.killed) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // noop
      }
    }
  }, graceMs);
}

function buildPublisherArgs(fifoPath, outputUrl) {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-f',
    's16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-i',
    fifoPath,
    '-c:a',
    'libopus',
    '-b:a',
    '24000',
    '-ar:a',
    '16000',
    '-ac:a',
    '1',
    '-application',
    'lowdelay',
    '-frame_duration',
    '10',
    '-compression_level',
    '0',
    '-fflags',
    'nobuffer',
    '-flush_packets',
    '1',
    '-muxdelay',
    '0',
    '-muxpreload',
    '0',
    '-f',
    'mpegts',
    outputUrl,
  ];
}

function buildSilenceWriterArgs() {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-re',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=mono:sample_rate=16000',
    '-f',
    's16le',
    '-ac',
    '1',
    '-ar',
    '16000',
    'pipe:1',
  ];
}

function buildUploadWriterArgs(filePath) {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-re',
    '-i',
    filePath,
    '-vn',
    '-af',
    'aresample=16000',
    '-f',
    's16le',
    '-ac',
    '1',
    '-ar',
    '16000',
    'pipe:1',
  ];
}

function attachWriterPipe(worker, proc) {
  const writer = fs.createWriteStream(worker.fifoPath, { flags: 'w' });
  writer.on('error', (err) => {
    const code = err?.code || 'unknown';
    if (code !== 'EPIPE') {
      logger.warn('writer pipe error', { roverId: worker?.roverId, code, message: err?.message || String(err) });
    }
  });
  proc.stdout.on('error', (err) => {
    logger.warn('writer stdout error', {
      roverId: worker?.roverId,
      code: err?.code || 'unknown',
      message: err?.message || String(err),
    });
  });
  proc.stdout.pipe(writer);
  proc.on('exit', () => {
    writer.destroy();
  });
}

function cleanupUploadFile(worker) {
  if (!worker?.activeUploadPath) return;
  try {
    fs.unlinkSync(worker.activeUploadPath);
  } catch {
    // noop
  }
  worker.activeUploadPath = null;
}

function stopContentProc(worker) {
  if (!worker) return;
  if (worker.contentProc) {
    stopProc(worker.contentProc);
  }
  worker.contentProc = null;
  worker.contentKind = null;
}

function startSilenceWriter(roverId) {
  const worker = workers.get(roverId);
  if (!worker || worker.stopping) return;

  stopContentProc(worker);
  cleanupUploadFile(worker);
  worker.activeOwnerSocketId = null;
  const proc = spawnFfmpeg(roverId, 'silence-writer', buildSilenceWriterArgs(), { captureStdout: true });
  worker.contentProc = proc;
  worker.contentKind = 'silence';
  const seq = ++worker.writerSeq;
  attachWriterPipe(worker, proc);

  proc.on('exit', (code, signal) => {
    const current = workers.get(roverId);
    if (!current || current.stopping) return;
    if (current.writerSeq !== seq || current.contentProc !== proc) return;
    current.contentProc = null;
    current.contentKind = null;
    if (code === 0 || signal === 'SIGTERM') return;
    setState(roverId, {
      state: 'error',
      source: 'silence',
      error: `silence writer exited code=${code} signal=${signal || 'none'}`,
      startedAt: null,
    });
    setTimeout(() => {
      if (workers.has(roverId)) startSilenceWriter(roverId);
    }, 300);
  });

  setState(roverId, { state: 'idle', source: 'silence', error: null, startedAt: null });
}

function startUploadWriter(roverId, filePath, ownerSocketId) {
  const worker = workers.get(roverId);
  if (!worker || worker.stopping) return;

  stopContentProc(worker);
  cleanupUploadFile(worker);
  worker.activeUploadPath = filePath;
  worker.activeOwnerSocketId = ownerSocketId || null;
  const proc = spawnFfmpeg(roverId, 'upload-writer', buildUploadWriterArgs(filePath), { captureStdout: true });
  worker.contentProc = proc;
  worker.contentKind = 'upload';
  const seq = ++worker.writerSeq;
  attachWriterPipe(worker, proc);

  setState(roverId, { state: 'playing', source: 'upload', error: null, startedAt: Date.now() });

  proc.on('exit', (code, signal) => {
    const current = workers.get(roverId);
    if (!current || current.stopping) return;
    if (current.writerSeq !== seq || current.contentProc !== proc) return;
    current.contentProc = null;
    current.contentKind = null;

    if (code != null && code !== 0 && signal !== 'SIGTERM') {
      setState(roverId, {
        state: 'error',
        source: 'upload',
        error: `upload writer exited code=${code} signal=${signal || 'none'}`,
        startedAt: null,
      });
    }
    startSilenceWriter(roverId);
  });
}

function ensureWorker(roverId) {
  if (!serviceEnabled) throw new Error('Audio forward disabled');
  if (!roverId) throw new Error('roverId required');

  const record = roverManager.rovers.get(roverId);
  if (!record || !record.ws) throw new Error('Rover offline');

  if (workers.has(roverId)) return workers.get(roverId);

  ensureRuntimeDir();
  const fifoPath = path.join(runtimeDir, `${sanitizeRoverId(roverId)}.pcm`);
  ensureFifo(fifoPath);
  const outputUrl = resolveForwardUrl(roverId);

  const keepaliveFd = fs.openSync(fifoPath, 'r+');
  const publisher = spawnFfmpeg(roverId, 'publisher', buildPublisherArgs(fifoPath, outputUrl));

  const worker = {
    roverId,
    fifoPath,
    keepaliveFd,
    outputUrl,
    publisherProc: publisher,
    contentProc: null,
    contentKind: null,
    writerSeq: 0,
    activeOwnerSocketId: null,
    activeUploadPath: null,
    stopping: false,
  };
  workers.set(roverId, worker);

  publisher.on('exit', (code, signal) => {
    const current = workers.get(roverId);
    if (!current || current.publisherProc !== publisher || current.stopping) return;
    setState(roverId, {
      state: 'error',
      source: current.contentKind || 'publish',
      error: `publisher exited code=${code} signal=${signal || 'none'}`,
      startedAt: null,
    });
  });

  startSilenceWriter(roverId);
  logger.info('Audio forward worker ready', { roverId, outputUrl, fifoPath });
  return worker;
}

function stopWorker(roverId) {
  const whipOwner = whipOwners.get(roverId);
  if (whipOwner) {
    whipOwners.delete(roverId);
    revokeWhipSessionForRover(roverId, whipOwner);
  }

  const worker = workers.get(roverId);
  if (!worker) return;

  worker.stopping = true;
  stopContentProc(worker);
  cleanupUploadFile(worker);
  stopProc(worker.publisherProc);

  try {
    fs.closeSync(worker.keepaliveFd);
  } catch {
    // noop
  }
  try {
    fs.unlinkSync(worker.fifoPath);
  } catch {
    // noop
  }

  workers.delete(roverId);
  setState(roverId, { state: 'offline', source: 'none', error: null, startedAt: null });
}

function writeUploadFile(roverId, payload = {}) {
  const { name, mime, dataBase64 } = payload || {};
  const ext = extFromUpload(name, mime);
  const encoded = typeof dataBase64 === 'string' ? dataBase64.trim() : '';
  if (!encoded) throw new Error('Upload payload missing');

  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw new Error('Upload decode failed');
  if (bytes.length > maxUploadBytes) throw new Error(`Upload too large (max ${maxUploadBytes} bytes)`);

  ensureRuntimeDir();
  const stem = sanitizeFileStem(name || `upload-${Date.now()}`);
  const filePath = path.join(uploadsDir, `${sanitizeRoverId(roverId)}-${Date.now()}-${stem}${ext}`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function playUploadedAudio(roverId, payload = {}, ownerSocketId = null) {
  stopWhipForRover(roverId, 'upload_override');
  ensureWorker(roverId);
  const uploadPath = writeUploadFile(roverId, payload);
  startUploadWriter(roverId, uploadPath, ownerSocketId);
}

function stopPlayback(roverId) {
  stopWhipForRover(roverId, 'stop_playback');
  ensureWorker(roverId);
  startSilenceWriter(roverId);
}

function revokeWhipSessionForRover(roverId, ownerSocketId) {
  if (!roverId || !ownerSocketId) return;
  const pathId = resolveForwardPathId(roverId);
  videoSessions.revokeWhere(
    (info) => info?.socketId === ownerSocketId && info?.sourceType === 'roverMic' && info?.sourceId === pathId,
  );
}

function stopWhipForRover(roverId, reason = 'unknown') {
  const ownerSocketId = whipOwners.get(roverId);
  if (!ownerSocketId) return;
  whipOwners.delete(roverId);
  revokeWhipSessionForRover(roverId, ownerSocketId);
  logger.info('Stopping WHIP mic session', { roverId, ownerSocketId, reason });
  try {
    ensureWorker(roverId);
    startSilenceWriter(roverId);
  } catch (err) {
    setState(roverId, { state: 'error', source: 'mic-whip', error: err?.message || String(err), startedAt: null });
  }
}

function stopOwnedAudioIfUnauthorized(roverId, ownerSocketId, reason = 'driver_change') {
  if (!roverId || !ownerSocketId) return;

  if (whipOwners.get(roverId) === ownerSocketId) {
    const ownerSocket = io.sockets.sockets.get(ownerSocketId);
    const ownerIsDriver = ownerSocket ? roverManager.isDriver(roverId, ownerSocket) : false;
    const ownerCanDrive = ownerSocket ? turnService.canDrive(roverId, ownerSocket) : false;
    if (!ownerIsDriver || !ownerCanDrive) {
      stopWhipForRover(roverId, reason);
    }
  }

  const worker = workers.get(roverId);
  if (!worker || worker.contentKind !== 'upload' || worker.activeOwnerSocketId !== ownerSocketId) return;

  const ownerSocket = io.sockets.sockets.get(ownerSocketId);
  const ownerIsDriver = ownerSocket ? roverManager.isDriver(roverId, ownerSocket) : false;
  const ownerCanDrive = ownerSocket ? turnService.canDrive(roverId, ownerSocket) : false;
  if (ownerIsDriver && ownerCanDrive) return;

  logger.info('Stopping upload audio due to ownership/driver change', { roverId, ownerSocketId, reason });
  startSilenceWriter(roverId);
}

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
});

module.exports = {
  getAudioForwardState,
  audioForwardEvents,
};
