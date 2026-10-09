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

function createWorkerManager({ getActiveSegmentRoot, onWorkerClosed }) {
  function startWorker(source) {
    const key = sourceKey(source);
    if (workers.has(key) || pendingWorkerStarts.has(key)) return;
    pendingWorkerStarts.add(key);
    const args = buildWorkerArgs(getActiveSegmentRoot(), source);
    const dir = sourceDirForKey(getActiveSegmentRoot(), key);
    ensureDir(dir)
      .then(() => {
        // Directory creation can finish after a microphone has disconnected.
        if (workers.has(key) || !listDesiredSources().some((entry) => sourceKey(entry) === key)) {
          pendingWorkerStarts.delete(key);
          return;
        }
        const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        const worker = { key, source, proc, stopping: false };
        workers.set(key, worker);
        pendingWorkerStarts.delete(key);
        proc.stderr.on('data', (chunk) => {
          const text = String(chunk || '').trim();
          if (!text) return;
          logger.warn('worker stderr', { key, text: text.slice(0, 500) });
        });
        proc.on('error', (err) => logger.warn('worker process failed', { key, error: err.message }));
        worker.finished = new Promise((resolve) => {
          proc.once('close', async (code, signal) => {
            clearTimeout(worker.killTimer);
            // FFmpeg writes the final MP4 trailer before close. Index it before
            // releasing this worker so a disconnect cannot drop its last audio.
            try { await onWorkerClosed(worker); }
            catch (err) { logger.warn('final worker indexing failed', { key, error: err.message }); }
            if (workers.get(key) === worker) workers.delete(key);
            resolve();
            logger.warn('worker exited', { key, code, signal });
            if (!worker.stopping) setTimeout(() => {
              const desired = listDesiredSources().find((entry) => sourceKey(entry) === key);
              if (desired && !workers.has(key)) startWorker(desired);
            }, 1500);
          });
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
    if (!worker.stopping) {
      worker.stopping = true;
      worker.proc.kill('SIGTERM');
      // Bound shutdown if a capture is blocked waiting on its network input.
      worker.killTimer = setTimeout(() => worker.proc.kill('SIGKILL'), 3000);
      worker.killTimer.unref();
    }
    return worker.finished;
  }

  async function syncWorkers() {
    const desired = listDesiredSources();
    const desiredKeys = new Set(desired.map(sourceKey));
    for (const source of desired) {
      const key = sourceKey(source);
      if (!workers.has(key)) startWorker(source);
    }
    const stops = [];
    for (const key of Array.from(workers.keys())) {
      if (!desiredKeys.has(key)) stops.push(stopWorker(key));
    }
    await Promise.all(stops);
  }

  return { startWorker, stopWorker, syncWorkers };
}

module.exports = { createWorkerManager };
