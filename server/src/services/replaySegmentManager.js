const { spawn } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const logger = require('../globals/logger').child('replaySegments');
const { getRoomCameras, roomCameraEvents } = require('./roomCameraService');
const roverManager = require('./roverManager');

const SEGMENT_DIR = process.env.REPLAY_SEGMENT_DIR || '/var/lib/replay-segments';
const SEGMENT_SECONDS = 2;
const BUFFER_SECONDS = 40;
const CLEANUP_INTERVAL_MS = 20000;
const FPS = 15;
const SCALE_WIDTH = 640;
const MAX_BYTES = Number.parseInt(process.env.REPLAY_SEGMENT_MAX_BYTES || '0', 10);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const ROVER_SNAPSHOT_DIR = process.env.ROVER_SNAPSHOT_DIR || '/var/lib/rover-snapshots';
const ROVER_SNAPSHOT_FPS = 3;

const recorders = new Map(); // key -> { proc, source }
let cleanupTimer = null;

function sourceKey(source) {
  return `${source.type}__${source.id}`;
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
  const rooms = getRoomCameras().map((camera) => ({
    type: 'room',
    id: String(camera.id),
    label: camera.name || camera.id,
    streamUrl: getRoomCameraStream(camera),
  }));
  const rovers = roverManager.getRoster().map((rover) => ({
    type: 'rover',
    id: String(rover.id),
    label: rover.name || rover.id,
  }));
  return [...rooms, ...rovers];
}

function buildInputUrl(source) {
  if (source.type === 'room') {
    return source.streamUrl || null;
  }
  return `srt://127.0.0.1:9000?streamid=read:${encodeURIComponent(source.id)}`;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function buildOutputPattern(key) {
  return path.join(SEGMENT_DIR, key, '%Y%m%d-%H%M%S.mp4');
}

function spawnRecorder(source) {
  const key = sourceKey(source);
  const inputUrl = buildInputUrl(source);
  if (!inputUrl) {
    logger.warn('Replay recorder missing input URL', { key, source });
    return;
  }
  const outPattern = buildOutputPattern(key);
  const outputSnapshot = source.type === 'rover'
    ? path.join(ROVER_SNAPSHOT_DIR, `${source.id}.jpg`)
    : null;
  ensureDir(path.dirname(outPattern))
    .then(async () => {
      if (outputSnapshot) {
        await ensureDir(ROVER_SNAPSHOT_DIR);
      }
      const args = [
        '-hide_banner',
        '-loglevel',
        'info',
        '-y',
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        '-i',
        inputUrl,
      ];
      if (outputSnapshot) {
        args.push(
          '-filter_complex',
          `[0:v]fps=${FPS},scale=${SCALE_WIDTH}:-1[vseg];` +
            `[0:v]fps=${ROVER_SNAPSHOT_FPS},scale=${SCALE_WIDTH}:-1[vjpg]`,
          '-map',
          '[vseg]',
          '-an',
          '-c:v:0',
          'libx264',
          '-preset',
          'veryfast',
          '-tune',
          'zerolatency',
          '-g',
          String(FPS),
          '-keyint_min',
          String(FPS),
          '-sc_threshold',
          '0',
          '-f',
          'segment',
          '-segment_time',
          String(SEGMENT_SECONDS),
          '-segment_format',
          'mp4',
          '-reset_timestamps',
          '1',
          '-strftime',
          '1',
          outPattern,
          '-map',
          '[vjpg]',
          '-an',
          '-q:v:1',
          '8',
          '-f',
          'image2',
          '-update',
          '1',
          outputSnapshot,
        );
      } else {
        args.push(
          '-r',
          String(FPS),
          '-vf',
          `fps=${FPS},scale=${SCALE_WIDTH}:-1`,
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-tune',
          'zerolatency',
          '-g',
          String(FPS),
          '-keyint_min',
          String(FPS),
          '-sc_threshold',
          '0',
          '-f',
          'segment',
          '-segment_time',
          String(SEGMENT_SECONDS),
          '-segment_format',
          'mp4',
          '-reset_timestamps',
          '1',
          '-strftime',
          '1',
          outPattern,
        );
      }
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
          logger.warn('Replay recorder stderr', {
            key,
            stderrBytes: stderrBuffer.length,
            stderrPreview: preview || '<non-utf8>',
          });
        } else {
          logger.warn('Replay recorder stderr', { key, stderrBytes: 0 });
        }
        if (!shouldRecord(source)) {
          return;
        }
        const delay = 2000;
        logger.warn('Replay recorder exited; restarting', { key, code, signal });
        setTimeout(() => {
          if (!recorders.has(key) && shouldRecord(source)) {
            spawnRecorder(source);
          }
        }, delay);
      });
    })
    .catch((err) => {
      logger.warn('Replay recorder setup failed', { key, err: err.message });
    });
}

function stopRecorder(key) {
  const entry = recorders.get(key);
  if (!entry) return;
  entry.proc.kill('SIGTERM');
  recorders.delete(key);
}

function shouldRecord(source) {
  if (source.type === 'room') {
    return Boolean(source.streamUrl);
  }
  return true;
}

function syncRecorders() {
  const sources = listSources();
  const desiredKeys = new Set();
  sources.forEach((source) => {
    if (!shouldRecord(source)) return;
    const key = sourceKey(source);
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
}

async function cleanupSegments() {
  try {
    await ensureDir(SEGMENT_DIR);
    const cutoff = Date.now() - BUFFER_SECONDS * 1000;
    const entries = await fsp.readdir(SEGMENT_DIR, { withFileTypes: true });
    let totalBytes = 0;
    const files = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(SEGMENT_DIR, entry.name);
      const inner = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const file of inner) {
        if (!file.isFile() || !file.name.endsWith('.mp4')) continue;
        const filePath = path.join(dirPath, file.name);
        const stats = await fsp.stat(filePath);
        totalBytes += stats.size;
        files.push({ filePath, mtimeMs: stats.mtimeMs, size: stats.size });
        if (stats.mtimeMs < cutoff) {
          await fsp.unlink(filePath);
        }
      }
      const remaining = await fsp.readdir(dirPath);
      if (!remaining.length) {
        await fsp.rmdir(dirPath);
      }
    }
    if (MAX_BYTES > 0 && totalBytes > MAX_BYTES) {
      const overBy = totalBytes - MAX_BYTES;
      let freed = 0;
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const file of files) {
        if (freed >= overBy) break;
        try {
          await fsp.unlink(file.filePath);
          freed += file.size;
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    logger.warn('Replay cleanup failed', err.message);
  }
}

function start() {
  syncRecorders();
  cleanupSegments();
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(cleanupSegments, CLEANUP_INTERVAL_MS);
}

roomCameraEvents.on('update', () => {
  syncRecorders();
});

roverManager.managerEvents.on('rover', () => {
  syncRecorders();
});

start();

module.exports = {
  replaySegmentsDir: SEGMENT_DIR,
  segmentSeconds: SEGMENT_SECONDS,
  bufferSeconds: BUFFER_SECONDS,
};
