const { execFile } = require('child_process');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const logger = require('../globals/logger').child('replayBuild');
const { replaySegmentsDir, segmentSeconds } = require('./replaySegmentManager');

const execFileAsync = promisify(execFile);

const REPLAY_DURATION_MS = 20000;
const REPLAY_FPS = 15;
const MAX_REPLAY_WIDTH = 1280;
const MAX_REPLAY_HEIGHT = 720;
const REPLAY_MAX_BYTES = Math.floor(9.5 * 1024 * 1024);

function buildGridLayout(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

function clampEven(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function buildScalePadFilter(tileWidth, tileHeight) {
  return `scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

async function probeMaxFrameSize(paths) {
  let maxWidth = 0;
  let maxHeight = 0;
  for (const filePath of paths) {
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
        filePath,
      ]);
      const [widthRaw, heightRaw] = stdout.trim().split(',');
      const width = Number(widthRaw);
      const height = Number(heightRaw);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        maxWidth = Math.max(maxWidth, width);
        maxHeight = Math.max(maxHeight, height);
      }
    } catch (err) {
      logger.warn('Failed to probe replay clip size', err.message);
    }
  }
  return { maxWidth, maxHeight };
}

async function listLatestSegments(sourceKey, neededCount) {
  const dir = path.join(replaySegmentsDir, sourceKey);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mp4')) continue;
    const filePath = path.join(dir, entry.name);
    const stat = await fsp.stat(filePath);
    if (stat.size < 16 * 1024) {
      continue;
    }
    if (now - stat.mtimeMs < segmentSeconds * 1000) {
      continue;
    }
    files.push({ filePath, mtimeMs: stat.mtimeMs });
  }
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return files.slice(-neededCount).map((file) => file.filePath);
}

async function buildReplayVideo({ sources = [] } = {}) {
  if (!sources.length) {
    throw new Error('No replay sources selected');
  }
  const segmentCount = Math.max(1, Math.ceil(REPLAY_DURATION_MS / (segmentSeconds * 1000)));
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rover-replay-'));
  try {
    const clipPaths = [];
    const usedSources = [];
    const missingSources = [];
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      const key = `${source.type}__${source.id}`;
      let segmentPaths;
      try {
        segmentPaths = await listLatestSegments(key, segmentCount);
      } catch (err) {
        missingSources.push({ ...source, reason: err.message || 'missing segments' });
        continue;
      }
      if (segmentPaths.length < segmentCount) {
        missingSources.push({
          ...source,
          reason: `only ${segmentPaths.length}/${segmentCount} segments available`,
        });
        continue;
      }
      const concatPath = path.join(tmpDir, `concat-${clipPaths.length}.txt`);
      const concatBody = segmentPaths.map((file) => `file '${file}'`).join('\n');
      await fsp.writeFile(concatPath, concatBody);
      const clipPath = path.join(tmpDir, `clip-${clipPaths.length}.mp4`);
      await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatPath,
        '-c',
        'copy',
        clipPath,
      ]);
      clipPaths.push(clipPath);
      usedSources.push(source);
    }
    if (!clipPaths.length) {
      throw new Error('No replay segments available for selected sources');
    }
    if (missingSources.length) {
      logger.warn('Replay sources missing segments', {
        missing: missingSources.map((source) => `${source.type}:${source.id}`),
      });
    }

    const { maxWidth, maxHeight } = await probeMaxFrameSize(clipPaths);
    const layout = buildGridLayout(clipPaths.length);
    let tileWidth = maxWidth || 640;
    let tileHeight = maxHeight || 360;
    let outputWidth = tileWidth * layout.cols;
    let outputHeight = tileHeight * layout.rows;
    if (outputWidth > MAX_REPLAY_WIDTH || outputHeight > MAX_REPLAY_HEIGHT) {
      const scale = Math.min(MAX_REPLAY_WIDTH / outputWidth, MAX_REPLAY_HEIGHT / outputHeight);
      tileWidth *= scale;
      tileHeight *= scale;
      outputWidth = tileWidth * layout.cols;
      outputHeight = tileHeight * layout.rows;
    }
    tileWidth = clampEven(tileWidth);
    tileHeight = clampEven(tileHeight);
    outputWidth = clampEven(tileWidth * layout.cols);
    outputHeight = clampEven(tileHeight * layout.rows);

    const inputArgs = [];
    const filterParts = [];
    const layoutParts = [];
    for (let i = 0; i < clipPaths.length; i += 1) {
      inputArgs.push('-i', clipPaths[i]);
      filterParts.push(`[${i}:v]${buildScalePadFilter(tileWidth, tileHeight)}[v${i}]`);
      const x = (i % layout.cols) * tileWidth;
      const y = Math.floor(i / layout.cols) * tileHeight;
      layoutParts.push(`${x}_${y}`);
    }
    if (clipPaths.length === 1) {
      filterParts.push('[v0]null[v]');
    } else {
      filterParts.push(
        `${clipPaths.map((_, i) => `[v${i}]`).join('')}` +
          `xstack=inputs=${clipPaths.length}:layout=${layoutParts.join('|')}:fill=black[v]`,
      );
    }

    const durationSec = Math.max(1, REPLAY_DURATION_MS / 1000);
    const targetBitrateKbps = Math.max(300, Math.floor((REPLAY_MAX_BYTES * 8) / durationSec / 1000));
    const maxrateKbps = Math.floor(targetBitrateKbps * 1.1);
    const bufsizeKbps = Math.floor(targetBitrateKbps * 2);

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
      String(REPLAY_FPS),
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
    return { buffer, usedSources, missingSources };
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn('Failed to cleanup replay temp dir', err.message);
    }
  }
}

module.exports = {
  buildReplayVideo,
};
