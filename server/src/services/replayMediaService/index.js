// Replay Media Service
// Purpose: Stores and serves completed replay videos when Discord delivery is unavailable.
// Scope: Owns only final hosted MP4 files; replay frame caches and active video builds remain outside this service.
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const logger = require('../../globals/logger').child('replayMedia');
const { app } = require('../../globals/http');
const { resolveDataDir } = require('../../helpers/dataPaths');

const REPLAY_DIR = path.join(resolveDataDir(), 'replays');
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const PUBLIC_FILE_PATTERN = /^[a-f0-9]{32}\.mp4$/;

async function listCompletedFiles() {
  await fsp.mkdir(REPLAY_DIR, { recursive: true });
  const entries = await fsp.readdir(REPLAY_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(REPLAY_DIR, entry.name);
    try {
      const stat = await fsp.stat(filePath);
      files.push({ name: entry.name, path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('Unable to inspect hosted replay', { file: entry.name, error: err.message });
    }
  }
  return files;
}

async function cleanup() {
  const now = Date.now();
  const files = await listCompletedFiles();
  const completed = files.filter((file) => PUBLIC_FILE_PATTERN.test(file.name)).sort((a, b) => a.mtimeMs - b.mtimeMs);
  const temporary = files.filter((file) => file.name.endsWith('.tmp'));

  // Temporary files are never served. An old one means a write was interrupted,
  // so it is safe to remove after the same conservative expiry used for media.
  const expiredTemporary = temporary.filter((file) => now - file.mtimeMs > MAX_AGE_MS);
  const expiredCompleted = completed.filter((file) => now - file.mtimeMs > MAX_AGE_MS);
  const toDelete = new Set([...expiredTemporary, ...expiredCompleted].map((file) => file.path));

  let retainedBytes = completed.reduce((total, file) => total + file.size, 0)
    - expiredCompleted.reduce((total, file) => total + file.size, 0);
  for (const file of completed) {
    if (retainedBytes <= MAX_TOTAL_BYTES) break;
    if (toDelete.has(file.path)) continue;
    toDelete.add(file.path);
    retainedBytes -= file.size;
  }

  await Promise.all(Array.from(toDelete).map(async (filePath) => {
    try {
      await fsp.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('Unable to remove hosted replay', { file: path.basename(filePath), error: err.message });
    }
  }));
}

async function hostReplay({ buffer, job }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Replay output was empty');
  await fsp.mkdir(REPLAY_DIR, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString('hex')}.mp4`;
  const finalPath = path.join(REPLAY_DIR, filename);
  const temporaryPath = `${finalPath}.${process.pid}.tmp`;

  // Atomic rename ensures cleanup and HTTP requests can only observe a fully
  // written MP4, never a partially flushed replay.
  try {
    await fsp.writeFile(temporaryPath, buffer, { flag: 'wx' });
    await fsp.rename(temporaryPath, finalPath);
  } catch (err) {
    await fsp.unlink(temporaryPath).catch(() => {});
    throw err;
  }

  return {
    jobId: job.id,
    status: 'ready',
    title: job.title,
    requester: job.requester,
    requestedBy: job.requestedBy || null,
    url: `/media/replays/${filename}`,
    proxyUrl: null,
    messageUrl: null,
    filename,
    size: buffer.length,
    contentType: 'video/mp4',
    sources: Array.isArray(job.sources) ? job.sources : [],
    ts: Date.now(),
  };
}

app.get('/media/replays/:filename', (req, res, next) => {
  const filename = String(req.params.filename || '');
  if (!PUBLIC_FILE_PATTERN.test(filename)) return res.status(404).end();
  const filePath = path.join(REPLAY_DIR, filename);
  // Express sendFile supports byte-range requests, which preserves seeking in
  // the existing browser video players without implementing a second streamer.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.sendFile(filePath, { headers: { 'Content-Type': 'video/mp4' } }, (err) => {
    if (!err || res.headersSent) return;
    if (err.code === 'ENOENT') return res.status(404).end();
    return next(err);
  });
});

cleanup().catch((err) => logger.warn('Initial hosted replay cleanup failed', err.message));
const cleanupTimer = setInterval(() => {
  cleanup().catch((err) => logger.warn('Hosted replay cleanup failed', err.message));
}, CLEANUP_INTERVAL_MS);
// Maintenance must never keep a process alive during normal shutdown.
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

module.exports = {
  hostReplay,
  cleanup,
  replayDirectory: REPLAY_DIR,
};
