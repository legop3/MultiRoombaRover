const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('audioForwardService');
const { loadConfig } = require('../helpers/configLoader');
const roverManager = require('./roverManager');
const { isAdmin } = require('./roleService');

const audioForwardEvents = new EventEmitter();
const config = loadConfig();
const audioForwardConfig = config.audioForward || {};
const serviceEnabled = audioForwardConfig.enabled !== false;
const ffmpegBin = audioForwardConfig.ffmpegBin || 'ffmpeg';
const streamSuffix = typeof audioForwardConfig.streamSuffix === 'string' ? audioForwardConfig.streamSuffix : '-fwd';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const defaultAudioPath = path.join(__dirname, '..', '..', 'assets', 'test-audio.mp3');
const configuredAudioPath = audioForwardConfig.testAudioPath;
const testAudioPath =
  configuredAudioPath && path.isAbsolute(configuredAudioPath)
    ? configuredAudioPath
    : configuredAudioPath
    ? path.resolve(repoRoot, configuredAudioPath)
    : defaultAudioPath;

const processes = new Map(); // roverId -> ChildProcess
const processErrors = new Map(); // roverId -> last stderr text
const states = new Map(); // roverId -> { state, error, startedAt, updatedAt }
const stopping = new Set();

function publishStateChange(roverId) {
  audioForwardEvents.emit('change', { roverId, state: states.get(roverId) || null });
}

function setState(roverId, next) {
  const prev = states.get(roverId) || {};
  const merged = {
    state: next.state || prev.state || 'idle',
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

function ensureReady() {
  if (!serviceEnabled) {
    throw new Error('Audio forward disabled');
  }
  if (!fs.existsSync(testAudioPath)) {
    throw new Error(`Test audio missing: ${testAudioPath}`);
  }
}

function resolveForwardUrl(roverId) {
  const record = roverManager.rovers.get(roverId);
  const configured = record?.meta?.media?.audioForwardUrl;
  if (configured) {
    return configured;
  }
  const fallback = `srt://127.0.0.1:9000?streamid=#!::r=${encodeURIComponent(roverId + streamSuffix)},m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316`;
  return fallback;
}

function buildFfmpegArgs(outputUrl) {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-stream_loop',
    '-1',
    '-re',
    '-i',
    testAudioPath,
    '-vn',
    '-af',
    'aresample=16000,pan=mono|c0=0.5*FL+0.5*FR,volume=12dB',
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
    '20',
    '-compression_level',
    '0',
    '-f',
    'mpegts',
    outputUrl,
  ];
}

function stopPlayback(roverId, options = {}) {
  const proc = processes.get(roverId);
  if (!proc) {
    setState(roverId, { state: 'idle', error: null, startedAt: null });
    return;
  }

  stopping.add(roverId);
  setState(roverId, { state: 'stopping', error: null });
  proc.kill('SIGTERM');

  setTimeout(() => {
    const active = processes.get(roverId);
    if (active && active.pid === proc.pid) {
      active.kill('SIGKILL');
    }
  }, options.killAfterMs || 2000);
}

function playTestAudio(roverId) {
  if (!roverId) {
    throw new Error('roverId required');
  }
  const record = roverManager.rovers.get(roverId);
  if (!record || !record.ws) {
    throw new Error('Rover offline');
  }

  ensureReady();
  stopPlayback(roverId, { killAfterMs: 1000 });

  const outputUrl = resolveForwardUrl(roverId);
  const args = buildFfmpegArgs(outputUrl);
  const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  processes.set(roverId, proc);
  processErrors.set(roverId, '');
  setState(roverId, { state: 'playing', error: null, startedAt: Date.now() });

  proc.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    processErrors.set(roverId, text);
  });

  proc.on('error', (err) => {
    const message = err?.message || 'ffmpeg spawn failed';
    logger.warn('audio forward process error', { roverId, message });
    if (processes.get(roverId)?.pid === proc.pid) {
      processes.delete(roverId);
      stopping.delete(roverId);
      setState(roverId, { state: 'error', error: message, startedAt: null });
    }
  });

  proc.on('exit', (code, signal) => {
    if (processes.get(roverId)?.pid === proc.pid) {
      processes.delete(roverId);
    }

    if (stopping.has(roverId)) {
      stopping.delete(roverId);
      setState(roverId, { state: 'idle', error: null, startedAt: null });
      return;
    }

    const stderr = processErrors.get(roverId) || null;
    const message = stderr || `ffmpeg exited code=${code} signal=${signal || 'none'}`;
    setState(roverId, { state: 'error', error: message, startedAt: null });
    logger.warn('audio forward exited unexpectedly', { roverId, code, signal, message });
  });

  logger.info('Started test audio playback', { roverId, outputUrl, testAudioPath });
}

roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
  if (!roverId || action !== 'removed') return;
  stopPlayback(roverId);
});

io.on('connection', (socket) => {
  socket.on('audio:testPlay', ({ roverId } = {}, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        throw new Error('Not authorized');
      }
      playTestAudio(String(roverId || '').trim());
      cb({ success: true, roverId });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audio:testStop', ({ roverId } = {}, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        throw new Error('Not authorized');
      }
      const normalized = String(roverId || '').trim();
      if (!normalized) {
        throw new Error('roverId required');
      }
      stopPlayback(normalized);
      cb({ success: true, roverId: normalized });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

module.exports = {
  getAudioForwardState,
  audioForwardEvents,
  playTestAudio,
  stopPlayback,
};
