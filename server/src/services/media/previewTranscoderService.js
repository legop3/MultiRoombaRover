const { spawn } = require('child_process');
const EventEmitter = require('events');
const logger = require('../../globals/logger').child('previewTranscoder');
const { loadConfig } = require('../../helpers/configLoader');
const roverManager = require('../roverManager');
const { getRoomCameras, roomCameraEvents } = require('../roomCameraService');

const events = new EventEmitter();
const config = loadConfig();
const mediaConfig = config.media || {};
const previewConfig = mediaConfig.preview || {};

const ENABLED = Boolean(previewConfig.enabled);
const PREVIEW_CODEC = String(previewConfig.codec || 'av1').toLowerCase();
const PREVIEW_FPS = Number(previewConfig.fps || 10);
const PREVIEW_WIDTH = Number(previewConfig.width || 640);
const ROOM_BITRATE_KBPS = Number(previewConfig.roomBitrateKbps || 200);
const ROVER_BITRATE_KBPS = Number(previewConfig.roverBitrateKbps || 350);
const PRESET = Number.isFinite(previewConfig.preset) ? String(previewConfig.preset) : '8';
const GOP_SECONDS = Number(previewConfig.gopSeconds || 2);
const FFMPEG_BIN = previewConfig.ffmpegBin || process.env.FFMPEG_BIN || 'ffmpeg';

const recorders = new Map(); // key -> { proc, source }
let syncTimer = null;

function encodeStreamId(streamId) {
  return encodeURIComponent(streamId).replace(/%2F/g, '/');
}

function buildSrtReadUrl(streamId) {
  return `srt://127.0.0.1:9000?streamid=read:${encodeStreamId(streamId)}`;
}

function buildSrtPublishUrl(streamId) {
  const encoded = encodeStreamId(streamId);
  return `srt://127.0.0.1:9000?streamid=#!::r=${encoded},m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316`;
}

function sanitizeCodec(codec) {
  return String(codec || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'av1';
}

function buildPreviewId(id, codec) {
  return `${id}-preview-${sanitizeCodec(codec)}`;
}

function getRoomCameraStream(camera) {
  if (camera.streamUrl) return camera.streamUrl;
  const url = String(camera.url || '');
  if (url.includes('.mjpg') || url.includes('mjpeg') || url.includes('stream')) {
    return url;
  }
  return null;
}

function listSources() {
  const rooms = getRoomCameras()
    .map((camera) => {
      const streamUrl = getRoomCameraStream(camera);
      if (!streamUrl) return null;
      const id = String(camera.id);
      return {
        type: 'room',
        id,
        label: camera.name || id,
        inputUrl: streamUrl,
        outputId: `room/${buildPreviewId(id, PREVIEW_CODEC)}`,
        bitrateKbps: ROOM_BITRATE_KBPS,
      };
    })
    .filter(Boolean);
  const rovers = roverManager.getRoster().map((rover) => {
    const id = String(rover.id);
    return {
      type: 'rover',
      id,
      label: rover.name || id,
      inputUrl: buildSrtReadUrl(id),
      outputId: buildPreviewId(id, PREVIEW_CODEC),
      bitrateKbps: ROVER_BITRATE_KBPS,
    };
  });
  return [...rooms, ...rovers];
}

function buildKey(source) {
  return `${source.type}:${source.id}:${source.outputId}`;
}

function buildArgs(source) {
  const gop = Math.max(1, Math.round(GOP_SECONDS * PREVIEW_FPS));
  const maxrate = Math.floor(source.bitrateKbps * 1.1);
  const bufsize = Math.max(1, source.bitrateKbps * 2);
  return [
    '-hide_banner',
    '-loglevel',
    'info',
    '-fflags',
    'nobuffer',
    '-flags',
    'low_delay',
    '-i',
    source.inputUrl,
    '-an',
    '-vf',
    `fps=${PREVIEW_FPS},scale=${PREVIEW_WIDTH}:-1`,
    '-c:v',
    PREVIEW_CODEC === 'av1' ? 'libsvtav1' : 'libx264',
    '-preset',
    PRESET,
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-b:v',
    `${source.bitrateKbps}k`,
    '-maxrate',
    `${maxrate}k`,
    '-bufsize',
    `${bufsize}k`,
    '-pix_fmt',
    'yuv420p',
    '-f',
    'mpegts',
    buildSrtPublishUrl(source.outputId),
  ];
}

function spawnRecorder(source) {
  const key = buildKey(source);
  if (recorders.has(key)) return;
  const args = buildArgs(source);
  const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const stderrChunks = [];
  let stderrSize = 0;
  proc.stderr.on('data', (chunk) => {
    if (!chunk || stderrSize > 8192) return;
    stderrChunks.push(chunk);
    stderrSize += chunk.length;
  });
  recorders.set(key, { proc, source });
  proc.on('exit', (code, signal) => {
    recorders.delete(key);
    const stderrBuffer = stderrChunks.length ? Buffer.concat(stderrChunks) : null;
    if (stderrBuffer && stderrBuffer.length) {
      const preview = stderrBuffer.toString('utf8', 0, 600).trim();
      logger.warn('Preview transcoder stderr', {
        key,
        stderrBytes: stderrBuffer.length,
        stderrPreview: preview || '<non-utf8>',
      });
    } else {
      logger.warn('Preview transcoder stderr', { key, stderrBytes: 0 });
    }
    if (!ENABLED) return;
    const delay = 2000;
    logger.warn('Preview transcoder exited; restarting', { key, code, signal });
    setTimeout(() => {
      if (!recorders.has(key) && ENABLED) {
        spawnRecorder(source);
      }
    }, delay);
  });
  events.emit('spawn', { key, source });
}

function stopRecorder(key) {
  const entry = recorders.get(key);
  if (!entry) return;
  entry.proc.kill('SIGTERM');
  recorders.delete(key);
  events.emit('stop', { key, source: entry.source });
}

function syncRecorders() {
  const sources = listSources();
  const desiredKeys = new Set();
  sources.forEach((source) => {
    const key = buildKey(source);
    desiredKeys.add(key);
    if (!recorders.has(key)) {
      spawnRecorder(source);
    }
  });
  Array.from(recorders.keys()).forEach((key) => {
    if (!desiredKeys.has(key)) {
      stopRecorder(key);
    }
  });
  logger.info('Preview transcoders synced', { total: desiredKeys.size });
}

function start() {
  if (!ENABLED) {
    logger.info('Preview transcoders disabled');
    return;
  }
  syncRecorders();
  if (!syncTimer) {
    syncTimer = setInterval(syncRecorders, 10000);
  }
}

function stop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  Array.from(recorders.keys()).forEach((key) => stopRecorder(key));
}

roverManager.managerEvents.on('rover', () => {
  if (ENABLED) {
    syncRecorders();
  }
});
roomCameraEvents.on('update', () => {
  if (ENABLED) {
    syncRecorders();
  }
});

start();

module.exports = {
  previewEvents: events,
  syncPreviewTranscoders: syncRecorders,
  stopPreviewTranscoders: stop,
};
