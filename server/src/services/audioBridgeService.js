const { spawn } = require('child_process');
const logger = require('../globals/logger').child('audioBridge');
const { loadConfig } = require('../helpers/configLoader');

const config = loadConfig();

const MEDIAMTX_API =
  process.env.MEDIAMTX_API || 'http://127.0.0.1:9997/v3/paths/list';
const SRT_HOST = process.env.MEDIAMTX_SRT_HOST || '127.0.0.1';
const POLL_MS = 5000;

// Track active ffmpeg bridges keyed by raw path name (e.g., rover-raw).
const bridges = new Map();

function stopBridge(rawName) {
  const proc = bridges.get(rawName);
  if (!proc) return;
  bridges.delete(rawName);
  proc.kill('SIGTERM');
  logger.info('stopped bridge', { rawName });
}

function startBridge(rawName, baseName) {
  if (bridges.has(rawName)) return;

  const inputUrl = `srt://${SRT_HOST}:9000?streamid=#!::r=${rawName},m=request&mode=caller&transtype=live&latency=20`;
  const outputUrl = `srt://${SRT_HOST}:9000?streamid=#!::r=${baseName},m=publish&mode=caller&transtype=live&pkt_size=1316`;

  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-fflags',
    'nobuffer',
    '-thread_queue_size',
    '512',
    '-i',
    inputUrl,
    '-map',
    '0:v',
    '-map',
    '0:a?',
    '-c:v',
    'copy',
    '-c:a',
    'libopus',
    '-b:a',
    '24000',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-application',
    'voip',
    '-frame_duration',
    '60',
    '-af',
    'pan=1c|c0=c0,volume=12dB',
    '-flush_packets',
    '1',
    '-f',
    'mpegts',
    outputUrl,
  ];

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  bridges.set(rawName, proc);
  logger.info('started bridge', { rawName, baseName });

  proc.stdout.on('data', (data) => {
    logger.info(data.toString().trim());
  });
  proc.stderr.on('data', (data) => {
    logger.info(data.toString().trim());
  });
  proc.on('exit', (code, signal) => {
    bridges.delete(rawName);
    logger.info('bridge exited', { rawName, code, signal });
  });
}

async function fetchPaths() {
  try {
    const res = await fetch(MEDIAMTX_API, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      throw new Error(`mediamtx api ${res.status}`);
    }
    return res.json();
  } catch (err) {
    logger.warn('path fetch failed: %s', err.message);
    return null;
  }
}

function pickRawPairs(items) {
  const names = new Set(items.map((i) => i.name));
  return items
    .filter((i) => i.name.endsWith('-raw'))
    .map((raw) => {
      const baseName = raw.name.slice(0, -4);
      return { rawName: raw.name, baseName };
    })
    .filter(({ baseName }) => !names.has(baseName));
}

async function reconcile() {
  const data = await fetchPaths();
  if (!data?.items) {
    // On failure, stop all bridges so we don't run blind.
    Array.from(bridges.keys()).forEach(stopBridge);
    return;
  }

  const activeRaw = new Set();
  pickRawPairs(data.items).forEach(({ rawName, baseName }) => {
    activeRaw.add(rawName);
    startBridge(rawName, baseName);
  });

  // Stop bridges whose raw path disappeared.
  Array.from(bridges.keys()).forEach((rawName) => {
    if (!activeRaw.has(rawName)) {
      stopBridge(rawName);
    }
  });
}

function start() {
  // Only enable when explicit media config allows it, or by default.
  const enabled = config.media?.audioBridge !== false;
  if (!enabled) {
    logger.info('audio bridge disabled by config');
    return;
  }
  logger.info('audio bridge enabled; watching for *-raw streams');
  reconcile();
  setInterval(reconcile, POLL_MS);
}

start();

module.exports = {
  start,
};
