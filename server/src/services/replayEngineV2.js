const { spawn, execFile } = require('child_process');
const fsp = require('fs/promises');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const EventEmitter = require('events');
const logger = require('../globals/logger').child('replayEngineV2');
const roverManager = require('./roverManager');
const { getRoomCameras, roomCameraEvents } = require('./roomCameraService');

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const SEGMENT_ROOT = process.env.REPLAY_SEGMENT_DIR || '/var/lib/replay-segments-v2';
const SEGMENT_SECONDS = Math.max(1, Number.parseInt(process.env.REPLAY_SEGMENT_SECONDS || '1', 10));
const BUFFER_SECONDS = Math.max(20, Number.parseInt(process.env.REPLAY_BUFFER_SECONDS || '45', 10));
const CLEANUP_INTERVAL_MS = 10_000;
const BUILD_DURATION_MS = Math.max(5000, Number.parseInt(process.env.REPLAY_DURATION_MS || '20000', 10));
const BUILD_GUARD_MS = Math.max(200, Number.parseInt(process.env.REPLAY_GUARD_MS || '1200', 10));
const TARGET_FPS = Math.max(10, Number.parseInt(process.env.REPLAY_TARGET_FPS || '30', 10));
const MAX_WIDTH = Math.max(320, Number.parseInt(process.env.REPLAY_MAX_WIDTH || '1280', 10));
const MAX_HEIGHT = Math.max(180, Number.parseInt(process.env.REPLAY_MAX_HEIGHT || '720', 10));
const MAX_BYTES = Math.floor(Number.parseFloat(process.env.REPLAY_MAX_OUTPUT_MB || '9.5') * 1024 * 1024);

const events = new EventEmitter();

const workers = new Map(); // key -> worker
const segmentIndex = new Map(); // key -> [{filePath,startMs,endMs,mtimeMs,size,kind,sourceType,sourceId}]
let cleanupTimer = null;

function sourceKey(source) {
  return `${source.sourceType}__${source.kind}__${source.id}`;
}

function sourceDirForKey(key) {
  return path.join(SEGMENT_ROOT, key);
}

function toSrtReadPath(streamId) {
  return `srt://127.0.0.1:9000?streamid=read:${encodeURIComponent(streamId)}`;
}

function getRoomCameraStream(camera) {
  if (camera?.streamUrl) return camera.streamUrl;
  const url = String(camera?.url || '');
  if (url.includes('.mjpg') || url.includes('mjpeg') || url.includes('stream')) return url;
  return null;
}

function listDesiredSources() {
  const sources = [];
  for (const rover of roverManager.getRoster()) {
    if (!roverManager.canReplayRoverId(rover.id)) continue;
    const roverId = String(rover.id);
    sources.push({
      id: roverId,
      sourceType: 'rover',
      kind: 'video',
      label: rover.name || roverId,
      inputUrl: toSrtReadPath(roverId),
    });
    if (rover?.media?.audioPublishUrl) {
      sources.push({
        id: `${roverId}-audio`,
        sourceType: 'rover',
        roverId,
        kind: 'audio',
        label: `${rover.name || roverId} audio`,
        inputUrl: toSrtReadPath(`${roverId}-audio`),
      });
    }
  }

  for (const camera of getRoomCameras()) {
    const streamUrl = getRoomCameraStream(camera);
    if (!streamUrl) continue;
    sources.push({
      id: String(camera.id),
      sourceType: 'room',
      kind: 'video',
      label: camera.name || camera.id,
      inputUrl: streamUrl,
    });
  }

  return sources;
}

function buildWorkerArgs(source) {
  const dir = sourceDirForKey(sourceKey(source));
  const pattern = path.join(dir, 'seg-%06d.mp4');
  const listPath = path.join(dir, 'index.csv');
  const listSize = Math.ceil((BUFFER_SECONDS + 10) / SEGMENT_SECONDS);

  const common = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-y',
    '-fflags',
    '+genpts',
    '-use_wallclock_as_timestamps',
    '1',
    '-i',
    source.inputUrl,
  ];

  if (source.kind === 'audio') {
    return [
      ...common,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-af',
      'aresample=48000',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-f',
      'segment',
      '-segment_time',
      String(SEGMENT_SECONDS),
      '-segment_atclocktime',
      '1',
      '-segment_list',
      listPath,
      '-segment_list_type',
      'csv',
      '-segment_list_size',
      String(listSize),
      '-segment_list_flags',
      '+live',
      '-reset_timestamps',
      '1',
      pattern,
    ];
  }

  return [
    ...common,
    '-an',
    '-vf',
    `fps=${TARGET_FPS}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(TARGET_FPS * SEGMENT_SECONDS),
    '-keyint_min',
    String(TARGET_FPS * SEGMENT_SECONDS),
    '-sc_threshold',
    '0',
    '-f',
    'segment',
    '-segment_time',
    String(SEGMENT_SECONDS),
    '-segment_atclocktime',
    '1',
    '-segment_list',
    listPath,
    '-segment_list_type',
    'csv',
    '-segment_list_size',
    String(listSize),
    '-segment_list_flags',
    '+live',
    '-reset_timestamps',
    '1',
    pattern,
  ];
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function startWorker(source) {
  const key = sourceKey(source);
  if (workers.has(key)) return;
  const dir = sourceDirForKey(key);
  ensureDir(dir)
    .then(() => {
      const proc = spawn(FFMPEG_BIN, buildWorkerArgs(source), { stdio: ['ignore', 'ignore', 'pipe'] });
      const worker = {
        key,
        source,
        proc,
      };
      workers.set(key, worker);
      proc.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (!text) return;
        logger.warn('worker stderr', { key, text: text.slice(0, 500) });
      });
      proc.on('exit', (code, signal) => {
        const current = workers.get(key);
        if (current?.proc === proc) {
          workers.delete(key);
        }
        logger.warn('worker exited', { key, code, signal });
        setTimeout(() => {
          const desired = listDesiredSources().find((entry) => sourceKey(entry) === key);
          if (desired && !workers.has(key)) {
            startWorker(desired);
          }
        }, 1500);
      });
    })
    .catch((err) => {
      logger.warn('failed to start worker', { key, error: err.message });
    });
}

function stopWorker(key) {
  const worker = workers.get(key);
  if (!worker) return;
  try {
    worker.proc.kill('SIGTERM');
  } catch {
    // noop
  }
  workers.delete(key);
}

async function syncWorkers() {
  const desired = listDesiredSources();
  const desiredKeys = new Set(desired.map(sourceKey));

  for (const source of desired) {
    const key = sourceKey(source);
    if (!workers.has(key)) {
      startWorker(source);
    }
  }

  for (const key of Array.from(workers.keys())) {
    if (!desiredKeys.has(key)) {
      stopWorker(key);
    }
  }
}

function parseCsvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(',');
  if (parts.length < 3) return null;
  return {
    filename: parts[0],
    startSec: Number(parts[1]),
    endSec: Number(parts[2]),
  };
}

async function refreshIndexForWorker(worker) {
  const key = worker.key;
  const dir = sourceDirForKey(key);
  const csvPath = path.join(dir, 'index.csv');
  let csv;
  try {
    csv = await fsp.readFile(csvPath, 'utf8');
  } catch {
    return;
  }

  const lines = csv.split(/\r?\n/).map(parseCsvLine).filter(Boolean);
  if (!lines.length) return;
  const cutoffMs = Date.now() - BUFFER_SECONDS * 1000 - 5000;

  const entries = [];
  for (const row of lines) {
    if (!Number.isFinite(row.startSec) || !Number.isFinite(row.endSec)) continue;
    const filePath = path.join(dir, row.filename);
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size < 4096) continue;
    const durSecRaw = row.endSec - row.startSec;
    const durationSec =
      Number.isFinite(durSecRaw) && durSecRaw > 0 && durSecRaw < SEGMENT_SECONDS * 6
        ? durSecRaw
        : SEGMENT_SECONDS;
    const endMs = Math.round(stat.mtimeMs);
    const startMs = Math.round(endMs - durationSec * 1000);
    if (endMs < cutoffMs) continue;
    entries.push({
      filePath,
      startMs,
      endMs,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      kind: worker.source.kind,
      sourceType: worker.source.sourceType,
      sourceId: worker.source.id,
      roverId: worker.source.roverId || null,
    });
  }

  segmentIndex.set(key, entries.sort((a, b) => a.startMs - b.startMs));
}

async function refreshSegmentIndex() {
  const list = Array.from(workers.values());
  for (const worker of list) {
    await refreshIndexForWorker(worker);
  }
}

async function cleanupOldFiles() {
  const cutoff = Date.now() - BUFFER_SECONDS * 1000;
  try {
    await ensureDir(SEGMENT_ROOT);
    const dirs = await fsp.readdir(SEGMENT_ROOT, { withFileTypes: true });
    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      const dirPath = path.join(SEGMENT_ROOT, dirent.name);
      let files;
      try {
        files = await fsp.readdir(dirPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.mp4')) continue;
        const filePath = path.join(dirPath, file.name);
        try {
          const stat = await fsp.stat(filePath);
          if (stat.mtimeMs < cutoff) {
            await fsp.unlink(filePath);
          }
        } catch {
          // noop
        }
      }
    }
  } catch (err) {
    logger.warn('cleanup failed', err.message);
  }
}

function getVideoEntriesForSource(source) {
  const key = sourceKey({ sourceType: String(source.type), kind: 'video', id: String(source.id) });
  return segmentIndex.get(key) || [];
}

function getAudioEntriesForRover(roverId) {
  const key = sourceKey({ sourceType: 'rover', kind: 'audio', id: `${String(roverId)}-audio` });
  return segmentIndex.get(key) || [];
}

function overlapping(entries, startMs, endMs) {
  return entries.filter((entry) => entry.endMs > startMs && entry.startMs < endMs);
}

function buildGridLayout(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

function clampEven(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function scalePadFilter(tileWidth, tileHeight) {
  return `scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

async function concatFiles(inputPaths, outPath) {
  const listPath = `${outPath}.concat.txt`;
  const body = inputPaths.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
  await fsp.writeFile(listPath, `${body}\n`, 'utf8');
  await execFileAsync(FFMPEG_BIN, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    outPath,
  ]);
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
      const [wRaw, hRaw] = stdout.trim().split(',');
      const w = Number(wRaw);
      const h = Number(hRaw);
      if (Number.isFinite(w) && Number.isFinite(h)) {
        maxWidth = Math.max(maxWidth, w);
        maxHeight = Math.max(maxHeight, h);
      }
    } catch {
      // noop
    }
  }
  return { maxWidth, maxHeight };
}

async function buildReplayVideo({ sources = [] } = {}) {
  if (!Array.isArray(sources) || !sources.length) {
    throw new Error('No replay sources selected');
  }

  const tEnd = Date.now() - BUILD_GUARD_MS;
  const tStart = tEnd - BUILD_DURATION_MS;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mrr-replay-v2-'));

  try {
    await refreshSegmentIndex();

    const usedSources = [];
    const missingSources = [];
    const normalizedVideos = [];
    const normalizedAudios = [];

    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      const sourceId = String(source.id);
      const videoEntries = overlapping(getVideoEntriesForSource({ id: sourceId }), tStart, tEnd);
      if (!videoEntries.length) {
        missingSources.push({ ...source, reason: 'no video coverage in replay window' });
        continue;
      }

      const videoConcat = path.join(tmpDir, `video-${i}.mp4`);
      await concatFiles(videoEntries.map((entry) => entry.filePath), videoConcat);
      const videoTrimmed = path.join(tmpDir, `video-${i}.trim.mp4`);
      const firstStartMs = videoEntries[0].startMs;
      const ss = Math.max(0, (tStart - firstStartMs) / 1000);
      const to = Math.max(ss + 0.1, (tEnd - firstStartMs) / 1000);
      await execFileAsync(FFMPEG_BIN, [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        ss.toFixed(3),
        '-to',
        to.toFixed(3),
        '-i',
        videoConcat,
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(TARGET_FPS),
        videoTrimmed,
      ]);

      normalizedVideos.push({ path: videoTrimmed, source });
      usedSources.push(source);

      if (source.type === 'rover') {
        const audioEntries = overlapping(getAudioEntriesForRover(sourceId), tStart, tEnd);
        if (audioEntries.length) {
          const audioConcat = path.join(tmpDir, `audio-${i}.m4a`);
          await concatFiles(audioEntries.map((entry) => entry.filePath), audioConcat);
          const audioTrimmed = path.join(tmpDir, `audio-${i}.trim.m4a`);
          const firstAudioStartMs = audioEntries[0].startMs;
          const ass = Math.max(0, (tStart - firstAudioStartMs) / 1000);
          const ato = Math.max(ass + 0.1, (tEnd - firstAudioStartMs) / 1000);
          await execFileAsync(FFMPEG_BIN, [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            ass.toFixed(3),
            '-to',
            ato.toFixed(3),
            '-i',
            audioConcat,
            '-vn',
            '-ac',
            '1',
            '-ar',
            '48000',
            '-c:a',
            'aac',
            '-b:a',
            '96k',
            audioTrimmed,
          ]);
          normalizedAudios.push(audioTrimmed);
        }
      }
    }

    if (!normalizedVideos.length) {
      throw new Error('No replay segments available for selected sources');
    }

    const layout = buildGridLayout(normalizedVideos.length);
    const { maxWidth, maxHeight } = await probeMaxFrameSize(normalizedVideos.map((v) => v.path));
    let tileWidth = maxWidth || 640;
    let tileHeight = maxHeight || 360;
    let outWidth = tileWidth * layout.cols;
    let outHeight = tileHeight * layout.rows;
    if (outWidth > MAX_WIDTH || outHeight > MAX_HEIGHT) {
      const scale = Math.min(MAX_WIDTH / outWidth, MAX_HEIGHT / outHeight);
      tileWidth *= scale;
      tileHeight *= scale;
      outWidth = tileWidth * layout.cols;
      outHeight = tileHeight * layout.rows;
    }
    tileWidth = clampEven(tileWidth);
    tileHeight = clampEven(tileHeight);

    const inputArgs = [];
    const filterParts = [];
    const layoutParts = [];

    for (let i = 0; i < normalizedVideos.length; i += 1) {
      inputArgs.push('-i', normalizedVideos[i].path);
      filterParts.push(`[${i}:v]${scalePadFilter(tileWidth, tileHeight)}[v${i}]`);
      const x = (i % layout.cols) * tileWidth;
      const y = Math.floor(i / layout.cols) * tileHeight;
      layoutParts.push(`${x}_${y}`);
    }

    const audioInputStart = normalizedVideos.length;
    for (const audioPath of normalizedAudios) {
      inputArgs.push('-i', audioPath);
    }

    if (normalizedVideos.length === 1) {
      filterParts.push('[v0]null[vout]');
    } else {
      filterParts.push(
        `${normalizedVideos.map((_, i) => `[v${i}]`).join('')}` +
          `xstack=inputs=${normalizedVideos.length}:layout=${layoutParts.join('|')}:fill=black[vout]`,
      );
    }

    if (normalizedAudios.length) {
      const audioRefs = normalizedAudios.map((_, idx) => `[${audioInputStart + idx}:a]`).join('');
      filterParts.push(`${audioRefs}amix=inputs=${normalizedAudios.length}:normalize=0,alimiter=limit=0.9[aout]`);
    }

    const durationSec = BUILD_DURATION_MS / 1000;
    const targetBitrateKbps = Math.max(400, Math.floor((MAX_BYTES * 8) / durationSec / 1000));
    const outPath = path.join(tmpDir, 'replay.mp4');

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputArgs,
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[vout]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(TARGET_FPS),
      '-b:v',
      `${targetBitrateKbps}k`,
      '-maxrate',
      `${Math.floor(targetBitrateKbps * 1.15)}k`,
      '-bufsize',
      `${Math.floor(targetBitrateKbps * 2)}k`,
    ];

    if (normalizedAudios.length) {
      args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
    }

    args.push(outPath);

    await execFileAsync(FFMPEG_BIN, args);
    const buffer = await fsp.readFile(outPath);
    return { buffer, usedSources, missingSources };
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // noop
    }
  }
}

function getReplayHealthSnapshot() {
  const now = Date.now();
  const neededWindowMs = BUILD_DURATION_MS;
  const sources = [];
  let readyCount = 0;

  const replaySources = [];
  for (const rover of roverManager.getRoster().filter((entry) => roverManager.canReplayRoverId(entry.id))) {
    replaySources.push({ type: 'rover', id: String(rover.id), label: rover.name || rover.id });
  }
  for (const camera of getRoomCameras()) {
    replaySources.push({ type: 'room', id: String(camera.id), label: camera.name || camera.id });
  }

  for (const source of replaySources) {
    const entries = getVideoEntriesForSource({ id: source.id });
    const inWindow = entries.filter((entry) => now - entry.endMs <= BUFFER_SECONDS * 1000);
    const newest = inWindow[inWindow.length - 1] || null;
    const oldest = inWindow[0] || null;
    const coveredMs = newest && oldest ? Math.max(0, newest.endMs - oldest.startMs) : 0;
    const ready = coveredMs >= neededWindowMs;
    if (ready) readyCount += 1;
    sources.push({
      type: source.type,
      id: source.id,
      label: source.label,
      recentCount: inWindow.length,
      neededCount: Math.ceil(neededWindowMs / 1000),
      lastSegmentAt: newest?.endMs || null,
      ready,
    });
  }

  return {
    sources,
    readyCount,
    totalCount: sources.length,
  };
}

async function bootstrapIndexFromDisk() {
  await ensureDir(SEGMENT_ROOT);
  const dirs = await fsp.readdir(SEGMENT_ROOT, { withFileTypes: true });
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    segmentIndex.set(dirent.name, []);
  }
}

async function tick() {
  await syncWorkers();
  await refreshSegmentIndex();
  await cleanupOldFiles();
  events.emit('health', getReplayHealthSnapshot());
}

async function start() {
  await ensureDir(SEGMENT_ROOT);
  await bootstrapIndexFromDisk();
  await tick();
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => {
    tick().catch((err) => logger.warn('tick failed', err.message));
  }, CLEANUP_INTERVAL_MS);
}

roomCameraEvents.on('update', () => {
  tick().catch((err) => logger.warn('room camera update tick failed', err.message));
});
roverManager.managerEvents.on('rover', () => {
  tick().catch((err) => logger.warn('rover update tick failed', err.message));
});
roverManager.managerEvents.on('private', () => {
  tick().catch((err) => logger.warn('private update tick failed', err.message));
});

start().catch((err) => {
  logger.warn('replay engine startup failed', err.message);
});

module.exports = {
  buildReplayVideo,
  getReplayHealthSnapshot,
  replayEngineEvents: events,
  replaySegmentRootDir: SEGMENT_ROOT,
  replaySegmentSeconds: SEGMENT_SECONDS,
  replayBufferSeconds: BUFFER_SECONDS,
};
