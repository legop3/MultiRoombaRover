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
const io = require('../globals/io');
const { getActiveDrivers } = require('./turnService');
const { getNickname } = require('./nicknameService');
const { getRecentMessages } = require('./chatService');
const sharp = require('sharp');

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const SEGMENT_ROOT = path.resolve(__dirname, '..', '..', 'data', 'replay-segments');
const SEGMENT_SECONDS = Math.max(1, Number.parseInt(process.env.REPLAY_SEGMENT_SECONDS || '1', 10));
const BUFFER_SECONDS = Math.max(20, Number.parseInt(process.env.REPLAY_BUFFER_SECONDS || '45', 10));
const CLEANUP_INTERVAL_MS = 10_000;
const BUILD_DURATION_MS = Math.max(5000, Number.parseInt(process.env.REPLAY_DURATION_MS || '20000', 10));
const BUILD_GUARD_MS = Math.max(200, Number.parseInt(process.env.REPLAY_GUARD_MS || '1200', 10));
const TARGET_FPS = Math.max(10, Number.parseInt(process.env.REPLAY_TARGET_FPS || '30', 10));
const MAX_WIDTH = Math.max(320, Number.parseInt(process.env.REPLAY_MAX_WIDTH || '1280', 10));
const MAX_HEIGHT = Math.max(180, Number.parseInt(process.env.REPLAY_MAX_HEIGHT || '720', 10));
const MAX_BYTES = Math.floor(Number.parseFloat(process.env.REPLAY_MAX_OUTPUT_MB || '9.5') * 1024 * 1024);
const SIDEBAR_WIDTH = Math.max(180, Number.parseInt(process.env.REPLAY_SIDEBAR_WIDTH || '250', 10));

const events = new EventEmitter();

const workers = new Map(); // key -> worker
const pendingWorkerStarts = new Set(); // key
const segmentIndex = new Map(); // key -> [{filePath,startMs,endMs,mtimeMs,size,kind,sourceType,sourceId}]
let cleanupTimer = null;
let activeSegmentRoot = SEGMENT_ROOT;
let tickInFlight = false;

function sourceKey(source) {
  return `${source.sourceType}__${source.kind}__${source.id}`;
}

function sourceDirForKey(key) {
  return path.join(activeSegmentRoot, key);
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
      'aresample=async=1:first_pts=0:min_hard_comp=0.100000,asetpts=N/SR/TB',
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
  if (workers.has(key) || pendingWorkerStarts.has(key)) return;
  pendingWorkerStarts.add(key);
  const dir = sourceDirForKey(key);
  ensureDir(dir)
    .then(() => {
      if (workers.has(key)) {
        pendingWorkerStarts.delete(key);
        return;
      }
      const proc = spawn(FFMPEG_BIN, buildWorkerArgs(source), { stdio: ['ignore', 'ignore', 'pipe'] });
      const worker = {
        key,
        source,
        proc,
      };
      workers.set(key, worker);
      pendingWorkerStarts.delete(key);
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
      pendingWorkerStarts.delete(key);
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

async function refreshIndexForWorker(worker) {
  const key = worker.key;
  const dir = sourceDirForKey(key);
  let files;
  try {
    files = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const segmentFiles = files
    .filter((entry) => entry.isFile() && /^seg-\d{6}\.mp4$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (!segmentFiles.length) {
    segmentIndex.set(key, []);
    return;
  }
  const cutoffMs = Date.now() - BUFFER_SECONDS * 1000 - 5000;

  const entries = [];
  for (const filename of segmentFiles) {
    const filePath = path.join(dir, filename);
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size < 4096) continue;
    const durationSec = SEGMENT_SECONDS;
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
    await ensureDir(activeSegmentRoot);
    const dirs = await fsp.readdir(activeSegmentRoot, { withFileTypes: true });
    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      const dirPath = path.join(activeSegmentRoot, dirent.name);
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

function sanitizeReplayTitle(title, fallback = 'Replay') {
  const value = String(title || '').trim();
  if (!value) return fallback;
  return value.slice(0, 120);
}

function resolveDefaultReplayTitle(requester = '', sources = []) {
  const requesterLabel = String(requester || 'Someone').trim() || 'Someone';
  const rover = (Array.isArray(sources) ? sources : []).find((entry) => entry?.type === 'rover');
  const roverLabel = rover?.label || rover?.id || 'a rover';
  return `${requesterLabel} driving ${roverLabel}`;
}

function buildDriverBatterySnapshot(selectedRoverIds = []) {
  const activeDrivers = getActiveDrivers();
  const byId = new Map(roverManager.getRoster().map((rover) => [String(rover.id), rover]));
  const lines = [];
  for (const roverId of selectedRoverIds) {
    const socketId = activeDrivers[String(roverId)];
    if (!socketId) continue;
    const socket = io.sockets.sockets.get(socketId);
    const nickname = getNickname(socket) || socket?.data?.user?.username || String(socketId);
    const rover = byId.get(String(roverId));
    const roverName = rover?.name || roverId;
    const percent = rover?.batteryState?.percentDisplay;
    const batteryLabel = Number.isFinite(percent) ? `${percent}%` : '--%';
    lines.push(`${nickname} driving ${roverName} (${batteryLabel})`);
  }
  return lines;
}

function buildChatEventsForWindow(startMs, endMs, limit = 22, preWindowCount = 10) {
  const all = getRecentMessages(300, { includeSystem: false });
  const normalized = all
    .filter((msg) => Number.isFinite(msg?.ts))
    .map((msg) => {
    const nickname = String(msg?.nickname || msg?.discordUserName || 'user').trim() || 'user';
    const text = String(msg?.text || '').replace(/\s+/g, ' ').trim();
    return {
      ts: Number(msg.ts),
      nickname: nickname.slice(0, 32),
      text: text.slice(0, 120),
      role: String(msg?.role || ''),
      fromDiscord: Boolean(msg?.fromDiscord),
      roverId: msg?.roverId ? String(msg.roverId) : '',
      roverColor: msg?.roverColor ? String(msg.roverColor) : '',
    };
  });
  const beforeWindow = normalized.filter((msg) => msg.ts < startMs).slice(-preWindowCount);
  const inWindow = normalized.filter((msg) => msg.ts >= startMs && msg.ts <= endMs).slice(-limit);
  return [...beforeWindow, ...inWindow].sort((a, b) => a.ts - b.ts);
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapTextLines(text, maxChars = 24) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function hexToRgb(hex) {
  const value = String(hex || '').trim();
  const match = /^#([0-9A-Fa-f]{6})$/.exec(value);
  if (!match) return null;
  const raw = match[1];
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

function roleColor(role = '') {
  switch (String(role)) {
    case 'admin':
    case 'lockdown':
    case 'lockdown-admin':
      return '#FCD34D'; // amber-300
    case 'spectator':
      return '#94A3B8'; // slate-400
    default:
      return '#7DD3FC'; // sky-300
  }
}

function renderSidebarSvg({
  width,
  height,
  title,
  driverBatteryLines,
  chatLines,
}) {
  const titleParts = wrapTextLines(title, 20).slice(0, 4).map((line) => escapeXml(line));
  const statLines = driverBatteryLines.slice(0, 8).map((line) => escapeXml(line));
  const normalizedChats = chatLines.slice(-12).map((entry) => {
    const wrapped = wrapTextLines(entry.text || '', 22).slice(0, 4).map((line) => escapeXml(line));
    const nick = escapeXml(entry.nickname || 'user');
    const roverId = escapeXml(entry.roverId || '');
    const roverRgb = hexToRgb(entry.roverColor || '');
    const roverBadgeBg = roverRgb ? `rgba(${roverRgb.r},${roverRgb.g},${roverRgb.b},0.18)` : 'rgba(30,41,59,0.70)';
    const roverBadgeBorder = roverRgb ? `rgba(${roverRgb.r},${roverRgb.g},${roverRgb.b},0.60)` : 'rgba(71,85,105,0.75)';
    return {
      nick,
      wrapped,
      nameColor: roleColor(entry.role),
      fromDiscord: Boolean(entry.fromDiscord),
      roverId,
      roverBadgeBg,
      roverBadgeBorder,
      bubbleTone: entry.fromDiscord ? 'discordBubble' : 'chatBubble',
    };
  });

  const shapes = [];
  const textRows = [];
  const pad = 5;
  const cardX = pad;
  const cardW = width - pad * 2;
  let y = 5;

  // Title card
  const titleCardH = Math.max(42, 12 + titleParts.length * 18);
  shapes.push(`<rect x="${cardX}" y="${y}" width="${cardW}" height="${titleCardH}" rx="4" class="card"/>`);
  let ty = y + 18;
  for (const part of titleParts) {
    textRows.push(`<text x="${cardX + 8}" y="${ty}" class="title">${part}</text>`);
    ty += 18;
  }
  y += titleCardH + 4;

  // Drivers card
  const driverLines = statLines.length ? statLines : ['No active drivers'];
  const driversCardH = 20 + driverLines.length * 16 + 6;
  shapes.push(`<rect x="${cardX}" y="${y}" width="${cardW}" height="${driversCardH}" rx="4" class="card"/>`);
  textRows.push(`<text x="${cardX + 8}" y="${y + 16}" class="section">Drivers</text>`);
  let dy = y + 32;
  for (const line of driverLines) {
    textRows.push(`<text x="${cardX + 8}" y="${dy}" class="${statLines.length ? 'body' : 'muted'}">${line}</text>`);
    dy += 16;
  }
  y += driversCardH + 4;

  // Chat card
  const chatCardH = Math.max(80, height - y - 5);
  shapes.push(`<rect x="${cardX}" y="${y}" width="${cardW}" height="${chatCardH}" rx="4" class="card"/>`);
  textRows.push(`<text x="${cardX + 8}" y="${y + 16}" class="section">Chat</text>`);

  let cy = y + 22;
  const bubbleX = cardX + 5;
  const bubbleW = cardW - 10;
  if (!normalizedChats.length) {
    textRows.push(`<text x="${cardX + 8}" y="${cy + 16}" class="muted">No chat in replay window</text>`);
  } else {
    for (let i = 0; i < normalizedChats.length; i += 1) {
      const block = normalizedChats[i];
      const nameW = Math.min(95, block.nick.length * 6);
      const badgeW = block.roverId ? Math.min(58, Math.max(24, block.roverId.length * 6 + 10)) : 0;
      const badgeGap = block.roverId ? 6 : 0;
      const prefixChars = Math.ceil((nameW + badgeW + badgeGap + 18) / 5.8);
      const firstLineRaw = String(block.wrapped[0] || '').trim();
      const firstLine = firstLineRaw ? firstLineRaw : '';
      const remainingRaw = block.wrapped.slice(firstLineRaw ? 1 : 0).map((line) => String(line || '').trim()).filter(Boolean);
      const fullText = (firstLine ? [firstLine, ...remainingRaw] : remainingRaw).join(' ');
      const inlineWrapped = wrapTextLines(fullText, Math.max(8, 26 - prefixChars)).slice(0, 4).map((line) => escapeXml(line));
      const bubbleH = 16 + inlineWrapped.length * 14;
      if (cy + bubbleH + 4 > y + chatCardH - 5) break;
      shapes.push(
        `<rect x="${bubbleX}" y="${cy}" width="${bubbleW}" height="${bubbleH}" rx="4" class="${block.bubbleTone}"/>`,
      );
      const nameX = bubbleX + 6;
      const textStartX = nameX + nameW + 4 + (block.roverId ? badgeW + badgeGap : 0);
      textRows.push(`<text x="${nameX}" y="${cy + 13}" class="chatName" fill="${block.nameColor}">${block.nick}</text>`);
      if (block.fromDiscord) {
        textRows.push(`<text x="${nameX + nameW + 2}" y="${cy + 13}" class="discordTag">◈</text>`);
      }
      if (block.roverId) {
        const badgeX = nameX + nameW + 4;
        const badgeTextX = badgeX + 5;
        shapes.push(
          `<rect x="${badgeX}" y="${cy + 3}" width="${badgeW}" height="12" rx="3" fill="${block.roverBadgeBg}" stroke="${block.roverBadgeBorder}" stroke-width="0.8"/>`,
        );
        textRows.push(`<text x="${badgeTextX}" y="${cy + 12}" class="roverTag">${block.roverId}</text>`);
      }
      let by = cy + 13;
      for (let lineIdx = 0; lineIdx < inlineWrapped.length; lineIdx += 1) {
        const line = inlineWrapped[lineIdx];
        const lineX = lineIdx === 0 ? textStartX : bubbleX + 6;
        textRows.push(`<text x="${lineX}" y="${by}" class="chat">${line}</text>`);
        by += 14;
      }
      cy += bubbleH + 4;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#000000"/>
  <style>
    .card { fill: #141414; stroke: #262626; stroke-width: 0.6; }
    .chatBubble { fill: #3f3f46; }
    .discordBubble { fill: #3f3f46; }
    .title { font-family: "DejaVu Sans", sans-serif; font-size: 15px; font-weight: 700; fill: #f8fafc; }
    .section { font-family: "DejaVu Sans", sans-serif; font-size: 11px; font-weight: 700; fill: #e2e8f0; text-transform: uppercase; letter-spacing: .3px; }
    .body { font-family: "DejaVu Sans", sans-serif; font-size: 11px; fill: #e2e8f0; }
    .chatName { font-family: "DejaVu Sans", sans-serif; font-size: 10px; font-weight: 700; }
    .chat { font-family: "DejaVu Sans", sans-serif; font-size: 10px; fill: #f8fafc; }
    .roverTag { font-family: "DejaVu Sans", sans-serif; font-size: 9px; fill: #dbeafe; }
    .discordTag { font-family: "DejaVu Sans", sans-serif; font-size: 10px; fill: #c7d2fe; }
    .muted { font-family: "DejaVu Sans", sans-serif; font-size: 10px; fill: #94a3b8; }
  </style>
  ${shapes.join('\n  ')}
  ${textRows.join('\n  ')}
</svg>`;
}

async function renderSidebarVideo({
  tmpDir,
  title,
  durationSec,
  height,
  windowStartMs,
  driverBatteryLines = [],
  chatEvents = [],
}) {
  const framesDir = path.join(tmpDir, 'sidebar-frames');
  const sidebarPath = path.join(tmpDir, 'sidebar.mp4');
  await ensureDir(framesDir);
  const secondCount = Math.max(1, Math.ceil(durationSec));
  for (let second = 0; second < secondCount; second += 1) {
    const sliceEndMs = windowStartMs + (second + 1) * 1000;
    const visibleChat = chatEvents.filter((entry) => entry.ts <= sliceEndMs).slice(-10);
    const svg = renderSidebarSvg({
      width: SIDEBAR_WIDTH,
      height,
      title,
      driverBatteryLines,
      chatLines: visibleChat,
    });
    const framePath = path.join(framesDir, `frame-${String(second + 1).padStart(4, '0')}.png`);
    await sharp(Buffer.from(svg, 'utf8')).png().toFile(framePath);
  }

  await execFileAsync(FFMPEG_BIN, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-framerate',
    '1',
    '-i',
    path.join(framesDir, 'frame-%04d.png'),
    '-vf',
    `fps=${TARGET_FPS},format=yuv420p`,
    '-t',
    durationSec.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    sidebarPath,
  ]);
  return sidebarPath;
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

async function buildReplayVideo({ sources = [], title = '', requester = '' } = {}) {
  if (!Array.isArray(sources) || !sources.length) {
    throw new Error('No replay sources selected');
  }

  const tEnd = Date.now() - BUILD_GUARD_MS;
  const tStart = tEnd - BUILD_DURATION_MS;
  const resolvedTitle = sanitizeReplayTitle(title, resolveDefaultReplayTitle(requester, sources));
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
      const videoEntries = overlapping(
        getVideoEntriesForSource({ type: String(source.type), id: sourceId }),
        tStart,
        tEnd,
      );
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

    const selectedRoverIds = usedSources
      .filter((entry) => entry?.type === 'rover')
      .map((entry) => String(entry.id));
    const driverBatteryLines = buildDriverBatterySnapshot(selectedRoverIds);
    const chatEvents = buildChatEventsForWindow(tStart, tEnd);
    const durationSec = BUILD_DURATION_MS / 1000;
    const sidebarPath = await renderSidebarVideo({
      tmpDir,
      title: resolvedTitle,
      durationSec,
      height: clampEven(tileHeight * layout.rows),
      windowStartMs: tStart,
      driverBatteryLines,
      chatEvents,
    });

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

    inputArgs.push('-i', sidebarPath);
    const sidebarInputIndex = normalizedVideos.length;
    const audioInputStart = normalizedVideos.length + 1;
    for (const audioPath of normalizedAudios) {
      inputArgs.push('-i', audioPath);
    }

    if (normalizedVideos.length === 1) {
      filterParts.push('[v0]null[vgrid]');
    } else {
      filterParts.push(
        `${normalizedVideos.map((_, i) => `[v${i}]`).join('')}` +
          `xstack=inputs=${normalizedVideos.length}:layout=${layoutParts.join('|')}:fill=black[vgrid]`,
      );
    }
    filterParts.push(`[vgrid][${sidebarInputIndex}:v]hstack=inputs=2[vout]`);

    if (normalizedAudios.length) {
      const audioRefs = normalizedAudios.map((_, idx) => `[${audioInputStart + idx}:a]`).join('');
      filterParts.push(`${audioRefs}amix=inputs=${normalizedAudios.length}:normalize=0,alimiter=limit=0.9[aout]`);
    }
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
    return { buffer, usedSources, missingSources, title: resolvedTitle };
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
  const neededCount = Math.max(1, Math.ceil(BUILD_DURATION_MS / 1000));
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
    const key = sourceKey({ sourceType: source.type, kind: 'video', id: String(source.id) });
    const dir = sourceDirForKey(key);
    let recentCount = 0;
    let lastSegmentAt = null;
    try {
      const files = fs.readdirSync(dir);
      for (const name of files) {
        if (!/^seg-\d{6}\.mp4$/.test(name)) continue;
        const full = path.join(dir, name);
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (!stat.isFile() || stat.size < 4096) continue;
        if (stat.mtimeMs > (lastSegmentAt || 0)) {
          lastSegmentAt = stat.mtimeMs;
        }
        if (now - stat.mtimeMs <= BUFFER_SECONDS * 1000) {
          recentCount += 1;
        }
      }
    } catch {
      // ignore missing source directory
    }
    const ready = recentCount >= neededCount;
    if (ready) readyCount += 1;
    sources.push({
      type: source.type,
      id: source.id,
      label: source.label,
      recentCount,
      neededCount,
      lastSegmentAt,
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
  await ensureDir(activeSegmentRoot);
  const dirs = await fsp.readdir(activeSegmentRoot, { withFileTypes: true });
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    segmentIndex.set(dirent.name, []);
  }
}

async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
  await syncWorkers();
  await refreshSegmentIndex();
  await cleanupOldFiles();
  events.emit('health', getReplayHealthSnapshot());
  } finally {
    tickInFlight = false;
  }
}

async function start() {
  await ensureDir(SEGMENT_ROOT);
  activeSegmentRoot = SEGMENT_ROOT;
  logger.info('Replay engine using segment root', { segmentRoot: activeSegmentRoot });
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
  replaySegmentRootDir: () => activeSegmentRoot,
  replaySegmentSeconds: SEGMENT_SECONDS,
  replayBufferSeconds: BUFFER_SECONDS,
};
