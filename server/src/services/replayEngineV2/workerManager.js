// Replay Worker Manager
// Purpose: Starts/stops ffmpeg segment workers and keeps active worker set aligned with desired sources.
// Scope: Owns worker process lifecycle and restart behavior for replay segment capture.
const { spawn } = require('child_process');
const fsp = require('fs/promises');
const logger = require('../../globals/logger').child('replayEngineV2');
const { FFMPEG_BIN } = require('./constants');
const { workers, pendingWorkerStarts } = require('./state');
const { sourceKey, sourceDirForKey, listDesiredSources, buildWorkerArgs } = require('./sources');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function createWorkerManager({ getActiveSegmentRoot }) {
  function startWorker(source) {
    const key = sourceKey(source);
    if (workers.has(key) || pendingWorkerStarts.has(key)) return;
    pendingWorkerStarts.add(key);
    const args = buildWorkerArgs(getActiveSegmentRoot(), source);
    const dir = sourceDirForKey(getActiveSegmentRoot(), key);
    ensureDir(dir)
      .then(() => {
        if (workers.has(key)) {
          pendingWorkerStarts.delete(key);
          return;
        }
        const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        workers.set(key, { key, source, proc });
        pendingWorkerStarts.delete(key);
        proc.stderr.on('data', (chunk) => {
          const text = String(chunk || '').trim();
          if (!text) return;
          logger.warn('worker stderr', { key, text: text.slice(0, 500) });
        });
        proc.on('exit', (code, signal) => {
          const current = workers.get(key);
          if (current?.proc === proc) workers.delete(key);
          logger.warn('worker exited', { key, code, signal });
          setTimeout(() => {
            const desired = listDesiredSources().find((entry) => sourceKey(entry) === key);
            if (desired && !workers.has(key)) startWorker(desired);
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
    try { worker.proc.kill('SIGTERM'); } catch {}
    workers.delete(key);
  }

  async function syncWorkers() {
    const desired = listDesiredSources();
    const desiredKeys = new Set(desired.map(sourceKey));
    for (const source of desired) {
      const key = sourceKey(source);
      if (!workers.has(key)) startWorker(source);
    }
    for (const key of Array.from(workers.keys())) {
      if (!desiredKeys.has(key)) stopWorker(key);
    }
  }

  return { startWorker, stopWorker, syncWorkers };
}

module.exports = { createWorkerManager };
