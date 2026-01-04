const { execFile } = require('child_process');
const EventEmitter = require('events');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const logger = require('../globals/logger').child('roomCameraReplay');
const { getRoomCamera, getRoomCameras } = require('./roomCameraService');

const execFileAsync = promisify(execFile);

const REPLAY_DURATION_MS = 20000;
const REPLAY_FPS = 15;
const HISTORY_WINDOW_MS = 60000;
const MAX_REPLAY_WIDTH = 1280;
const MAX_REPLAY_HEIGHT = 720;
const REPLAY_MAX_BYTES = Math.floor(9.5 * 1024 * 1024);

const frameHistory = new Map(); // id -> [{ buffer, ts }]
const latestFrames = new Map(); // id -> { buffer, ts }
const events = new EventEmitter();

function recordFrame(id, buffer, ts = Date.now()) {
  if (!id || !buffer) return;
  const entry = { buffer, ts };
  latestFrames.set(id, entry);
  const history = frameHistory.get(id) || [];
  history.push(entry);
  const cutoff = ts - HISTORY_WINDOW_MS;
  while (history.length && history[0].ts < cutoff) {
    history.shift();
  }
  frameHistory.set(id, history);
  events.emit('frame', { id, ts });
}

function clearFrames() {
  frameHistory.clear();
  latestFrames.clear();
}

function getReplayMetadata() {
  return {
    durationMs: REPLAY_DURATION_MS,
    fps: REPLAY_FPS,
  };
}

function buildTimelineForCamera(id, startMs, frameCount, frameStepMs) {
  const history = frameHistory.get(id) || [];
  const fallback = latestFrames.get(id)?.buffer || null;
  if (!history.length && !fallback) return null;
  let idx = 0;
  let lastBuffer = null;
  while (idx < history.length && history[idx].ts < startMs) {
    lastBuffer = history[idx].buffer;
    idx += 1;
  }
  if (!lastBuffer) {
    lastBuffer = history[0]?.buffer || fallback;
  }
  const frames = new Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    const slotTs = startMs + i * frameStepMs;
    while (idx < history.length && history[idx].ts <= slotTs) {
      lastBuffer = history[idx].buffer;
      idx += 1;
    }
    frames[i] = lastBuffer || fallback;
  }
  return frames;
}

function buildGridLayout(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

async function probeMaxFrameSize(framePaths) {
  let maxWidth = 0;
  let maxHeight = 0;
  for (const framePath of framePaths) {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        framePath,
      ]);
      const [widthRaw, heightRaw] = stdout.trim().split(',');
      const width = Number(widthRaw);
      const height = Number(heightRaw);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        maxWidth = Math.max(maxWidth, width);
        maxHeight = Math.max(maxHeight, height);
      }
    } catch (err) {
      logger.warn('Failed to probe replay frame size', err.message);
    }
  }
  return { maxWidth, maxHeight };
}

function buildScalePadFilter(tileWidth, tileHeight) {
  return `scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

function clampEven(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

async function buildReplayVideo({ cameraId = null } = {}) {
  const cameras = cameraId ? [getRoomCamera(cameraId)].filter(Boolean) : getRoomCameras();
  if (!cameras.length) {
    throw new Error('No room cameras configured');
  }

  const fpsValue = REPLAY_FPS;
  const frameCount = Math.max(1, Math.round((REPLAY_DURATION_MS / 1000) * fpsValue));
  const frameStepMs = 1000 / fpsValue;
  const startMs = Date.now() - REPLAY_DURATION_MS;

  const cameraEntries = [];
  cameras.forEach((camera) => {
    const frames = buildTimelineForCamera(camera.id, startMs, frameCount, frameStepMs);
    if (!frames) return;
    cameraEntries.push({ camera, frames });
  });

  if (!cameraEntries.length) {
    throw new Error('No camera frames available yet');
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rover-replay-'));
  try {
    const firstFramePaths = [];
    for (let i = 0; i < cameraEntries.length; i += 1) {
      const entry = cameraEntries[i];
      const camDir = path.join(tmpDir, `cam-${String(i).padStart(2, '0')}`);
      entry.dir = camDir;
      await fsp.mkdir(camDir, { recursive: true });
      for (let j = 0; j < entry.frames.length; j += 1) {
        const buffer = entry.frames[j];
        if (!buffer) {
          throw new Error(`Camera ${entry.camera.id} missing replay frame`);
        }
        const filename = `frame-${String(j + 1).padStart(4, '0')}.jpg`;
        const fullPath = path.join(camDir, filename);
        if (j === 0) {
          firstFramePaths.push(fullPath);
        }
        await fsp.writeFile(fullPath, buffer);
      }
    }

    const { maxWidth, maxHeight } = await probeMaxFrameSize(firstFramePaths);
    const layout = buildGridLayout(cameraEntries.length);
    let tileWidth = maxWidth || 640;
    let tileHeight = maxHeight || 360;
    let outputWidth = tileWidth * layout.cols;
    let outputHeight = tileHeight * layout.rows;
    if (outputWidth > MAX_REPLAY_WIDTH || outputHeight > MAX_REPLAY_HEIGHT) {
      const scale = Math.min(MAX_REPLAY_WIDTH / outputWidth, MAX_REPLAY_HEIGHT / outputHeight);
      tileWidth = tileWidth * scale;
      tileHeight = tileHeight * scale;
      outputWidth = tileWidth * layout.cols;
      outputHeight = tileHeight * layout.rows;
    }
    tileWidth = clampEven(tileWidth);
    tileHeight = clampEven(tileHeight);
    outputWidth = clampEven(tileWidth * layout.cols);
    outputHeight = clampEven(tileHeight * layout.rows);

    const fps = fpsValue.toFixed(3);
    const durationSec = Math.max(1, frameCount / fpsValue);
    const targetBitrateKbps = Math.max(300, Math.floor((REPLAY_MAX_BYTES * 8) / durationSec / 1000));
    const maxrateKbps = Math.floor(targetBitrateKbps * 1.1);
    const bufsizeKbps = Math.floor(targetBitrateKbps * 2);

    const inputArgs = [];
    const filterParts = [];
    const layoutParts = [];
    for (let i = 0; i < cameraEntries.length; i += 1) {
      inputArgs.push('-framerate', fps, '-i', path.join(cameraEntries[i].dir, 'frame-%04d.jpg'));
      filterParts.push(
        `[${i}:v]${buildScalePadFilter(tileWidth, tileHeight)}[v${i}]`,
      );
      const x = (i % layout.cols) * tileWidth;
      const y = Math.floor(i / layout.cols) * tileHeight;
      layoutParts.push(`${x}_${y}`);
    }
    filterParts.push(
      `${cameraEntries.map((_, i) => `[v${i}]`).join('')}` +
        `xstack=inputs=${cameraEntries.length}:layout=${layoutParts.join('|')}:fill=black[v]`,
    );

    const outPath = path.join(tmpDir, 'replay.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputArgs,
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[v]',
      '-r',
      fps,
      '-c:v',
      'libx264',
      '-b:v',
      `${targetBitrateKbps}k`,
      '-maxrate',
      `${maxrateKbps}k`,
      '-bufsize',
      `${bufsizeKbps}k`,
      '-pix_fmt',
      'yuv420p',
      outPath,
    ]);
    const buffer = await fsp.readFile(outPath);
    return buffer;
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn('Failed to cleanup replay temp dir', err.message);
    }
  }
}

module.exports = {
  recordRoomCameraFrame: recordFrame,
  clearRoomCameraReplayFrames: clearFrames,
  getRoomCameraReplayMetadata: getReplayMetadata,
  buildRoomCameraReplayVideo: buildReplayVideo,
  roomCameraReplayEvents: events,
};
