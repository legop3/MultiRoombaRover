const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const EventEmitter = require('events');
const logger = require('../globals/logger').child('audioForwardService');
const { loadConfig } = require('../helpers/configLoader');
const roverManager = require('./roverManager');

const audioForwardEvents = new EventEmitter();
const config = loadConfig();
const audioForwardConfig = config.audioForward || {};
const serviceEnabled = audioForwardConfig.enabled !== false;
const ffmpegBin = audioForwardConfig.ffmpegBin || 'ffmpeg';
const streamSuffix =
  typeof audioForwardConfig.streamSuffix === 'string' && audioForwardConfig.streamSuffix.trim()
    ? audioForwardConfig.streamSuffix.trim()
    : '-fwd';
const runtimeDir = path.resolve(audioForwardConfig.runtimeDir || '/tmp/mrr-audio-forward');

const states = new Map(); // roverId -> { state, source, error, updatedAt }
const workers = new Map(); // roverId -> worker

function publishStateChange(roverId) {
  audioForwardEvents.emit('change', { roverId, state: states.get(roverId) || null });
}

function setState(roverId, next = {}) {
  const prev = states.get(roverId) || {};
  const merged = {
    state: next.state || prev.state || 'idle',
    source: Object.prototype.hasOwnProperty.call(next, 'source') ? next.source : prev.source || 'silence',
    error: Object.prototype.hasOwnProperty.call(next, 'error') ? next.error : prev.error || null,
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
}

function sanitizeRoverId(roverId) {
  return String(roverId || '').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

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

function forcePublishStreamMode(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (!/[?&]streamid=#!::/.test(value)) return value;
  if (/,m=publish\b/.test(value)) return value;
  if (/,m=[a-zA-Z]+\b/.test(value)) return value.replace(/,m=[a-zA-Z]+\b/, ',m=publish');
  return value.replace(/([?&]streamid=#!::[^&]*)/, '$1,m=publish');
}

function resolveForwardUrl(roverId) {
  const record = roverManager.rovers.get(roverId);
  const configured = record?.meta?.media?.audioForwardUrl;
  if (configured) return forcePublishStreamMode(configured);
  return `srt://127.0.0.1:9000?streamid=#!::r=${encodeURIComponent(
    roverId + streamSuffix,
  )},m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316`;
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

function attachWriterPipe(worker, proc) {
  const writer = fs.createWriteStream(worker.fifoPath, { flags: 'w' });
  writer.on('error', (err) => {
    const code = err?.code || 'unknown';
    if (code !== 'EPIPE') {
      logger.warn('silence writer pipe error', { roverId: worker?.roverId, code, message: err?.message || String(err) });
    }
  });
  proc.stdout.on('error', (err) => {
    logger.warn('silence writer stdout error', {
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

function stopContentProc(worker) {
  if (!worker) return;
  if (worker.contentProc) {
    stopProc(worker.contentProc);
  }
  worker.contentProc = null;
}

function startSilenceWriter(roverId) {
  const worker = workers.get(roverId);
  if (!worker || worker.stopping) return;

  stopContentProc(worker);
  const proc = spawnFfmpeg(roverId, 'silence-writer', buildSilenceWriterArgs(), { captureStdout: true });
  worker.contentProc = proc;
  const seq = ++worker.writerSeq;
  attachWriterPipe(worker, proc);

  proc.on('exit', (code, signal) => {
    const current = workers.get(roverId);
    if (!current || current.stopping) return;
    if (current.writerSeq !== seq || current.contentProc !== proc) return;
    current.contentProc = null;
    if (code === 0 || signal === 'SIGTERM') return;
    setState(roverId, { state: 'error', source: 'silence', error: `silence writer exited code=${code} signal=${signal || 'none'}` });
    setTimeout(() => {
      if (workers.has(roverId)) startSilenceWriter(roverId);
    }, 300);
  });

  setState(roverId, { state: 'idle', source: 'silence', error: null });
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
    writerSeq: 0,
    stopping: false,
  };
  workers.set(roverId, worker);

  publisher.on('exit', (code, signal) => {
    const current = workers.get(roverId);
    if (!current || current.publisherProc !== publisher || current.stopping) return;
    setState(roverId, {
      state: 'error',
      source: 'publish',
      error: `publisher exited code=${code} signal=${signal || 'none'}`,
    });
  });

  startSilenceWriter(roverId);
  logger.info('Audio forward worker ready', { roverId, outputUrl, fifoPath });
  return worker;
}

function stopWorker(roverId) {
  const worker = workers.get(roverId);
  if (!worker) return;

  worker.stopping = true;
  stopContentProc(worker);
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
  setState(roverId, { state: 'offline', source: 'none', error: null });
}

roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
  if (!roverId) return;
  if (action === 'removed') {
    stopWorker(roverId);
    return;
  }
  if (action === 'upsert' && serviceEnabled) {
    try {
      ensureWorker(roverId);
    } catch (err) {
      setState(roverId, { state: 'error', source: 'init', error: err.message });
    }
  }
});

module.exports = {
  getAudioForwardState,
  audioForwardEvents,
};
