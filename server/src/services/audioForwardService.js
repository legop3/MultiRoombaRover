const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('audioForwardService');
const { loadConfig } = require('../helpers/configLoader');
const roverManager = require('./roverManager');
const { isVerified } = require('./verificationService');
const turnService = require('./turnService');
const videoSessions = require('./videoSessions');

const audioForwardEvents = new EventEmitter();
const config = loadConfig();
const audioForwardConfig = config.audioForward || {};
const mediaConfig = config.media || {};
const serviceEnabled = audioForwardConfig.enabled !== false;
const ffmpegBin = audioForwardConfig.ffmpegBin || 'ffmpeg';
const streamSuffix = typeof audioForwardConfig.streamSuffix === 'string' ? audioForwardConfig.streamSuffix : '-fwd';
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

function setState(roverId, next) {
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

function ensureServiceEnabled() {
  if (!serviceEnabled) {
    throw new Error('Audio forward disabled');
  }
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

function ensureVipVerified(socket) {
  if (!isVerified(socket)) {
    throw new Error('VIP verification required');
  }
}

function ensureAudioForwardPermission(socket, roverId) {
  ensureVipVerified(socket);
  if (!roverManager.isDriver(roverId, socket)) {
    throw new Error('Audio forwarding is only allowed on your own rover');
  }
  if (!turnService.canDrive(roverId, socket)) {
    throw new Error('Only the current driver can play audio');
  }
}

function ensureFifo(fifoPath) {
  try {
    const stat = fs.statSync(fifoPath);
    if (stat.isFIFO()) {
      return;
    }
    fs.unlinkSync(fifoPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  const result = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`mkfifo failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
}

function forcePublishStreamMode(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (!/[?&]streamid=#!::/.test(value)) {
    return value;
  }

  if (/,m=publish\b/.test(value)) {
    return value;
  }

  if (/,m=[a-zA-Z]+\b/.test(value)) {
    return value.replace(/,m=[a-zA-Z]+\b/, ',m=publish');
  }

  return value.replace(/([?&]streamid=#!::[^&]*)/, '$1,m=publish');
}

function resolveForwardUrl(roverId) {
  const record = roverManager.rovers.get(roverId);
  const configured = record?.meta?.media?.audioForwardUrl;
  if (configured) {
    return forcePublishStreamMode(configured);
  }
  return `srt://127.0.0.1:9000?streamid=#!::r=${encodeURIComponent(roverId + streamSuffix)},m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316`;
}

function resolveForwardPathId(roverId) {
  return `${roverId}${streamSuffix}`;
}

function getMediaPrefix() {
  const base = mediaConfig.whepBaseUrl;
  if (!base) return '';
  try {
    const parsed = new URL(base);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return String(base).replace(/\/+$/, '');
  }
}

function buildWhipUrl(pathId) {
  const prefix = getMediaPrefix();
  if (!prefix) {
    throw new Error('Server media base URL missing');
  }
  return `${prefix}/${encodeURIComponent(pathId)}/whip`;
}

function spawnProcess(roverId, tag, args, options = {}) {
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
    // Broken pipe is expected when FIFO reader (publisher) restarts/exits.
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

function stopContentWriter(worker) {
  if (!worker) return;
  if (worker.micIdleTimer) {
    clearTimeout(worker.micIdleTimer);
    worker.micIdleTimer = null;
  }
  worker.micLastChunkAt = 0;
  worker.micBackpressured = false;
  if (worker.micWriter && !worker.micWriter.destroyed) {
    try {
      worker.micWriter.end();
    } catch {
      // noop
    }
    try {
      worker.micWriter.destroy();
    } catch {
      // noop
    }
  }
  worker.micWriter = null;
  if (worker.contentProc && worker.contentProc.stdin && !worker.contentProc.stdin.destroyed) {
    try {
      worker.contentProc.stdin.destroy();
    } catch {
      // noop
    }
  }
  if (worker.contentProc) {
    stopProc(worker.contentProc);
  }
  worker.contentProc = null;
  worker.contentKind = null;
  worker.activeOwnerSocketId = null;
}

function startSilenceWriter(roverId) {
  const worker = workers.get(roverId);
  if (!worker || worker.stopping) return;

  stopContentWriter(worker);
  cleanupUploadFile(worker);
  const proc = spawnProcess(roverId, 'silence-writer', buildSilenceWriterArgs(), { captureStdout: true });
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
    if (code === 0 || signal === 'SIGTERM') {
      return;
    }
    setState(roverId, { state: 'error', source: 'silence', error: `silence writer exited code=${code} signal=${signal || 'none'}` });
    setTimeout(() => {
      if (workers.has(roverId)) startSilenceWriter(roverId);
    }, 300);
  });

  setState(roverId, { state: 'idle', source: 'silence', error: null, startedAt: null });
}

function startUploadWriter(roverId, filePath) {
  const worker = workers.get(roverId);
  if (!worker || worker.stopping) return;

  stopContentWriter(worker);
  cleanupUploadFile(worker);
  worker.activeUploadPath = filePath;
  worker.activeOwnerSocketId = null;
  const proc = spawnProcess(roverId, 'upload-writer', buildUploadWriterArgs(filePath), { captureStdout: true });
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
      setState(roverId, { state: 'error', source: 'upload', error: `upload writer exited code=${code} signal=${signal || 'none'}` });
    }
    startSilenceWriter(roverId);
  });
}

function scheduleMicIdleTimeout(roverId) {
  const worker = workers.get(roverId);
  if (!worker || worker.contentKind !== 'mic') return;
  if (worker.micIdleTimer) {
    clearTimeout(worker.micIdleTimer);
  }
  worker.micIdleTimer = setTimeout(() => {
    const current = workers.get(roverId);
    if (!current || current.contentKind !== 'mic') return;
    const staleForMs = Date.now() - (current.micLastChunkAt || 0);
    if (staleForMs < 2500) return;
    logger.info('Stopping mic writer due to idle chunk timeout', { roverId, staleForMs });
    startSilenceWriter(roverId);
  }, 3000);
}

function startMicWriter(roverId, ownerSocketId = null) {
  stopWhipForRover(roverId, 'socket_mic_override');
  const worker = workers.get(roverId);
  if (!worker || worker.stopping) return;
  if (
    worker.contentKind === 'mic' &&
    worker.micWriter &&
    worker.activeOwnerSocketId === ownerSocketId
  ) {
    return;
  }

  stopContentWriter(worker);
  cleanupUploadFile(worker);
  const writer = fs.createWriteStream(worker.fifoPath, { flags: 'w' });
  writer.on('error', (err) => {
    const code = err?.code || 'unknown';
    if (code !== 'EPIPE') {
      logger.warn('mic fifo writer error', { roverId, code, message: err?.message || String(err) });
    }
  });
  writer.on('drain', () => {
    const current = workers.get(roverId);
    if (!current || current.contentKind !== 'mic') return;
    current.micBackpressured = false;
  });
  writer.on('close', () => {
    const current = workers.get(roverId);
    if (!current || current.contentKind !== 'mic') return;
    current.micWriter = null;
    current.micBackpressured = false;
  });

  worker.micWriter = writer;
  worker.micBackpressured = false;
  worker.contentProc = null;
  worker.contentKind = 'mic';
  worker.activeOwnerSocketId = ownerSocketId;
  worker.micLastChunkAt = Date.now();
  scheduleMicIdleTimeout(roverId);

  setState(roverId, { state: 'playing', source: 'mic', error: null, startedAt: Date.now() });
}

function decodeMicChunk(payload = {}) {
  const binary = payload?.data;
  if (Buffer.isBuffer(binary)) {
    return binary;
  }
  if (binary && typeof binary === 'object' && binary.type === 'Buffer' && Array.isArray(binary.data)) {
    return Buffer.from(binary.data);
  }
  if (binary instanceof Uint8Array) {
    return Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength);
  }
  if (binary instanceof ArrayBuffer) {
    return Buffer.from(binary);
  }
  if (typeof payload?.dataBase64 === 'string' && payload.dataBase64.trim()) {
    return Buffer.from(payload.dataBase64.trim(), 'base64');
  }
  return Buffer.alloc(0);
}

function pushMicChunk(roverId, ownerSocketId, payload = {}) {
  const worker = workers.get(roverId);
  if (!worker) {
    throw new Error('Audio forward worker unavailable');
  }
  if (worker.contentKind !== 'mic' || !worker.micWriter || worker.activeOwnerSocketId !== ownerSocketId) {
    throw new Error('Mic forwarding is not active');
  }
  const bytes = decodeMicChunk(payload);
  if (!bytes.length) {
    throw new Error('Mic chunk missing');
  }
  if (bytes.length % 2 !== 0) {
    throw new Error('Mic chunk has invalid PCM byte length');
  }
  if (bytes.length > 64 * 1024) {
    throw new Error('Mic chunk too large');
  }
  if (worker.micWriter.writable !== true) {
    throw new Error('Mic writer input is not writable');
  }
  if (worker.micBackpressured || worker.micWriter.writableNeedDrain) {
    // Preserve low latency by dropping stale mic packets instead of queueing.
    return;
  }
  worker.micLastChunkAt = Date.now();
  const wrote = worker.micWriter.write(bytes);
  if (!wrote) {
    worker.micBackpressured = true;
  }
  scheduleMicIdleTimeout(roverId);
}

function ensureWorker(roverId) {
  ensureServiceEnabled();
  if (!roverId) {
    throw new Error('roverId required');
  }
  const record = roverManager.rovers.get(roverId);
  if (!record || !record.ws) {
    throw new Error('Rover offline');
  }
  if (workers.has(roverId)) {
    return workers.get(roverId);
  }

  ensureRuntimeDir();
  const fifoPath = path.join(runtimeDir, `${sanitizeRoverId(roverId)}.pcm`);
  ensureFifo(fifoPath);
  const outputUrl = resolveForwardUrl(roverId);

  // Keep FIFO open so reader/writer open calls don't block when switching writers.
  const keepaliveFd = fs.openSync(fifoPath, 'r+');
  const publisher = spawnProcess(roverId, 'publisher', buildPublisherArgs(fifoPath, outputUrl));

  const worker = {
    roverId,
    fifoPath,
    keepaliveFd,
    outputUrl,
    publisherProc: publisher,
    contentProc: null,
    contentKind: null,
    activeOwnerSocketId: null,
    activeUploadPath: null,
    micWriter: null,
    micLastChunkAt: 0,
    micIdleTimer: null,
    micBackpressured: false,
    writerSeq: 0,
    stopping: false,
  };
  workers.set(roverId, worker);

  publisher.on('exit', (code, signal) => {
    const current = workers.get(roverId);
    if (!current || current.publisherProc !== publisher) return;
    if (current.stopping) return;
    setState(roverId, {
      state: 'error',
      source: current.contentKind || 'silence',
      error: `publisher exited code=${code} signal=${signal || 'none'}`,
      startedAt: null,
    });
  });

  startSilenceWriter(roverId);
  logger.info('Audio forward worker ready', { roverId, outputUrl, fifoPath });
  return worker;
}

function writeUploadFile(roverId, payload = {}) {
  const { name, mime, dataBase64 } = payload || {};
  const ext = extFromUpload(name, mime);
  const encoded = typeof dataBase64 === 'string' ? dataBase64.trim() : '';
  if (!encoded) {
    throw new Error('Upload payload missing');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) {
    throw new Error('Upload decode failed');
  }
  if (bytes.length > maxUploadBytes) {
    throw new Error(`Upload too large (max ${maxUploadBytes} bytes)`);
  }
  ensureRuntimeDir();
  const stem = sanitizeFileStem(name || `upload-${Date.now()}`);
  const filePath = path.join(uploadsDir, `${sanitizeRoverId(roverId)}-${Date.now()}-${stem}${ext}`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function playUploadedAudio(roverId, payload = {}) {
  stopWhipForRover(roverId, 'upload_override');
  const ownerSocketId = typeof payload?.ownerSocketId === 'string' ? payload.ownerSocketId : null;
  const uploadPath = writeUploadFile(roverId, payload);
  ensureWorker(roverId);
  const worker = workers.get(roverId);
  if (worker) {
    worker.activeOwnerSocketId = ownerSocketId;
  }
  startUploadWriter(roverId, uploadPath);
  if (worker) {
    worker.activeOwnerSocketId = ownerSocketId;
  }
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
    setState(roverId, { state: 'error', source: 'whip', error: err?.message || String(err), startedAt: null });
  }
}

function stopWorker(roverId) {
  stopWhipForRover(roverId, 'worker_stop');
  const worker = workers.get(roverId);
  if (!worker) return;
  worker.stopping = true;

  stopContentWriter(worker);
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

roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
  if (!roverId) return;
  if (action === 'removed') {
    stopWorker(roverId);
    return;
  }
  if (action === 'upsert' && serviceEnabled) {
    if (whipOwners.has(roverId)) {
      // WHIP publishes directly to the forward path; avoid recreating local publisher mid-session.
      return;
    }
    try {
      ensureWorker(roverId);
    } catch (err) {
      setState(roverId, { state: 'error', source: 'init', error: err.message, startedAt: null });
    }
  }
});

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
  if (!worker) return;
  if (worker.contentKind !== 'upload' && worker.contentKind !== 'mic') return;
  if (worker.activeOwnerSocketId !== ownerSocketId) return;
  const ownerSocket = io.sockets.sockets.get(ownerSocketId);
  const ownerIsDriver = ownerSocket ? roverManager.isDriver(roverId, ownerSocket) : false;
  const ownerCanDrive = ownerSocket ? turnService.canDrive(roverId, ownerSocket) : false;
  if (ownerIsDriver && ownerCanDrive) return;
  logger.info('Stopping audio forward due to ownership/driver change', { roverId, ownerSocketId, reason, source: worker.contentKind });
  startSilenceWriter(roverId);
}

roverManager.managerEvents.on('driver', ({ socketId, roverId, action } = {}) => {
  if (!socketId || !roverId) return;
  if (action === 'remove' || action === 'add') {
    stopOwnedAudioIfUnauthorized(roverId, socketId, action);
  }
});

turnService.turnEvents.on('activeDriver', ({ roverId } = {}) => {
  if (!roverId) return;
  const whipOwner = whipOwners.get(roverId);
  if (whipOwner) {
    stopOwnedAudioIfUnauthorized(roverId, whipOwner, 'turn_change');
  }
  const worker = workers.get(roverId);
  if (!worker || (worker.contentKind !== 'upload' && worker.contentKind !== 'mic')) return;
  stopOwnedAudioIfUnauthorized(roverId, worker.activeOwnerSocketId, 'turn_change');
});

io.on('connection', (socket) => {
  socket.on('audio:uploadPlay', (payload = {}, cb = () => {}) => {
    try {
      const roverId = String(payload?.roverId || '').trim();
      ensureAudioForwardPermission(socket, roverId);
      const normalized = String(roverId || '').trim();
      playUploadedAudio(normalized, { ...(payload || {}), ownerSocketId: socket.id });
      cb({ success: true, roverId: normalized });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audio:uploadStop', ({ roverId } = {}, cb = () => {}) => {
    try {
      const normalized = String(roverId || '').trim();
      ensureAudioForwardPermission(socket, normalized);
      stopPlayback(normalized);
      cb({ success: true, roverId: normalized });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audio:micStart', ({ roverId } = {}, cb = () => {}) => {
    try {
      const normalized = String(roverId || '').trim();
      ensureAudioForwardPermission(socket, normalized);
      ensureWorker(normalized);
      startMicWriter(normalized, socket.id);
      cb({ success: true, roverId: normalized });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audio:micChunk', (payload = {}, cb) => {
    try {
      const normalized = String(payload?.roverId || '').trim();
      ensureAudioForwardPermission(socket, normalized);
      pushMicChunk(normalized, socket.id, payload);
      if (typeof cb === 'function') cb({ success: true });
    } catch (err) {
      if (typeof cb === 'function') cb({ error: err.message });
    }
  });

  socket.on('audio:micStop', ({ roverId } = {}, cb = () => {}) => {
    try {
      const normalized = String(roverId || '').trim();
      ensureAudioForwardPermission(socket, normalized);
      const worker = workers.get(normalized);
      if (worker && worker.contentKind === 'mic' && worker.activeOwnerSocketId !== socket.id) {
        throw new Error('Mic forwarding is owned by another session');
      }
      stopPlayback(normalized);
      cb({ success: true, roverId: normalized });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audio:micWhipStart', ({ roverId } = {}, cb = () => {}) => {
    try {
      const normalized = String(roverId || '').trim();
      ensureAudioForwardPermission(socket, normalized);
      // WHIP publishes directly to the same forward path; stop local publisher to avoid path conflicts.
      stopWorker(normalized);
      whipOwners.set(normalized, socket.id);
      const pathId = resolveForwardPathId(normalized);
      revokeWhipSessionForRover(normalized, socket.id);
      const token = videoSessions.createSession(socket, { type: 'roverMic', id: pathId });
      const whipUrl = buildWhipUrl(pathId);
      setState(normalized, { state: 'starting', source: 'mic-whip', error: null, startedAt: Date.now() });
      cb({ success: true, roverId: normalized, pathId, token, whipUrl });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audio:micWhipReady', ({ roverId } = {}, cb = () => {}) => {
    try {
      const normalized = String(roverId || '').trim();
      ensureAudioForwardPermission(socket, normalized);
      if (whipOwners.get(normalized) !== socket.id) {
        throw new Error('WHIP session not owned by this client');
      }
      setState(normalized, { state: 'playing', source: 'mic-whip', error: null, startedAt: Date.now() });
      cb({ success: true, roverId: normalized });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audio:micWhipStop', ({ roverId } = {}, cb = () => {}) => {
    try {
      const normalized = String(roverId || '').trim();
      ensureAudioForwardPermission(socket, normalized);
      if (whipOwners.get(normalized) && whipOwners.get(normalized) !== socket.id) {
        throw new Error('Mic forwarding is owned by another session');
      }
      stopWhipForRover(normalized, 'client_stop');
      cb({ success: true, roverId: normalized });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('disconnect', () => {
    workers.forEach((worker, roverId) => {
      if (!worker || worker.activeOwnerSocketId !== socket.id) return;
      if (worker.contentKind !== 'upload' && worker.contentKind !== 'mic') return;
      logger.info('Stopping owned audio forward due to socket disconnect', { roverId, socketId: socket.id, source: worker.contentKind });
      startSilenceWriter(roverId);
    });
    for (const [roverId, ownerSocketId] of whipOwners.entries()) {
      if (ownerSocketId !== socket.id) continue;
      stopWhipForRover(roverId, 'socket_disconnect');
    }
  });
});

module.exports = {
  getAudioForwardState,
  audioForwardEvents,
  playUploadedAudio,
  stopPlayback,
};
