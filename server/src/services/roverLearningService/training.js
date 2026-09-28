// One owned finite worker at a time. Leases are acquired in the runtime's
// serialized maintenance pass, before retention can next inspect recordings.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const { listRecordings } = require('./storage');

function createTrainer({ root, config, actionThreshold, logger }) {
  const leases = new Set();
  const trainingRoot = path.join(root, 'training');
  let ledger = {};
  let child = null;
  let completion = Promise.resolve();
  let stopped = false;
  let nextRun = 0;
  let startupError = false;
  let state = { status: config.enabled ? 'waiting' : 'disabled', steps: 0, examples: 0 };

  async function start() {
    if (!config.enabled) return;
    try {
      await fs.mkdir(trainingRoot, { recursive: true });
      await fs.mkdir(path.join(root, 'models'), { recursive: true });
      // Only unpublished staging directories from an interrupted old worker
      // are disposable. Permanent UUID model directories are never removed.
      for (const entry of await fs.readdir(path.join(root, 'models'), { withFileTypes: true })) {
        if (entry.isDirectory() && /^\.[0-9a-f-]{36}\.pending$/.test(entry.name)) {
          await fs.rm(path.join(root, 'models', entry.name), { recursive: true });
        }
      }
      try {
        const saved = JSON.parse(await fs.readFile(path.join(trainingRoot, 'schedule.json'), 'utf8'));
        ledger = saved.sessions;
        state = { ...saved.progress, status: 'waiting' };
        if (!ledger || typeof ledger !== 'object') throw new Error('Invalid training schedule');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } catch (error) {
      startupError = true;
      state = { ...state, status: 'error', error: error.message };
      logger.error('Training initialization failed; recording remains available', { error: error.message });
    }
  }

  async function saveLedger() {
    const filename = path.join(trainingRoot, 'schedule.json');
    await fs.writeFile(`${filename}.tmp`, JSON.stringify({ sessions: ledger, progress: state }));
    await fs.rename(`${filename}.tmp`, filename);
  }

  async function tick(activeIds) {
    if (!config.enabled || startupError || stopped || child || Date.now() < nextRun) return;
    nextRun = Date.now() + config.intervalSeconds * 1000;
    const recordings = await listRecordings(path.join(root, 'recordings'));
    const present = new Set(recordings.map((recording) => recording.id));
    // Scheduling history is bounded by recording retention, unlike models.
    for (const id of Object.keys(ledger)) if (!present.has(id)) delete ledger[id];
    const eligible = [];
    for (const recording of recordings) {
      if (activeIds.has(recording.id) || ledger[recording.id]?.rejected) continue;
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(recording.directory, 'session.json'), 'utf8'));
        if (metadata.bufferOnly || !metadata.endedAt || metadata.error || metadata.droppedEvents || metadata.reason === 'interrupted') continue;
        eligible.push(recording.id);
      } catch (error) {
        ledger[recording.id] = { rejected: `Unreadable session metadata: ${error.message}` };
      }
    }
    // Random cohorts mix old and new retained sessions without repeatedly
    // favoring the first files in directory order.
    for (let index = eligible.length - 1; index > 0; index -= 1) {
      const other = randomInt(index + 1);
      [eligible[index], eligible[other]] = [eligible[other], eligible[index]];
    }
    const selected = eligible.slice(0, 4);
    nextRun = Date.now() + config.intervalSeconds * 1000;
    if (!selected.length) {
      state = { ...state, status: 'waiting', reason: 'Waiting for completed usable human recordings' };
      await saveLedger();
      return;
    }
    const jobPath = path.join(trainingRoot, 'job.json');
    await fs.writeFile(jobPath, JSON.stringify({ root, config, actionThreshold, sessions: selected }));
    if (stopped) return;
    selected.forEach((id) => leases.add(id));
    state = { ...state, status: 'training', reason: null, sessions: selected };
    state.startedAt = Date.now();
    child = spawn(config.python, [path.join(__dirname, 'workers/train.py'), '--job', jobPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', OMP_NUM_THREADS: String(config.threads), MKL_NUM_THREADS: String(config.threads) },
    });
    let output = '';
    let stderr = '';
    let result = null;
    let errorMessage = null;
    let forcedTimer;
    const worker = child;
    const deadline = setTimeout(() => {
      worker.kill('SIGTERM');
      forcedTimer = setTimeout(() => worker.kill('SIGKILL'), 5000);
    }, (config.maxJobSeconds + 15) * 1000);
    child.on('error', (error) => { errorMessage = error.message; });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) {
        errorMessage = 'Training worker output exceeded protocol bound';
        worker.kill('SIGKILL');
        return;
      }
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.kind === 'complete') result = message;
          if (message.kind === 'error') errorMessage = message.message;
          if (message.kind === 'skipped') logger.warn('Training skipped recording', message);
          if (message.kind === 'dataset') state = { ...state, lastSampledWindows: message.sampled, lastAvailableWindows: message.windows };
          if (message.kind === 'progress') state = { ...state, steps: message.steps, examples: message.examples, loss: message.loss };
        } catch { errorMessage = 'Invalid training worker message'; }
      }
    });
    completion = new Promise((resolve) => {
      child.once('close', async (code, signal) => {
        clearTimeout(deadline);
        clearTimeout(forcedTimer);
        try {
          if (code !== 0 || errorMessage || !result) {
            state = { ...state, status: stopped ? 'stopped' : 'error', error: errorMessage || `Worker exited ${code ?? signal}` };
            if (!stopped) logger.error('Training job failed', { error: state.error, stderr });
          } else {
            for (const [id, reason] of Object.entries(result.rejected || {})) ledger[id] = { rejected: reason };
            if (result.trained) {
              for (const id of result.accepted) ledger[id] = { rounds: (ledger[id]?.rounds || 0) + 1 };
            }
            state = { ...state, status: stopped ? 'stopped' : 'waiting', steps: result.steps ?? state.steps,
              completedAt: Date.now(), elapsedSeconds: result.elapsedSeconds ?? null, error: null,
              examples: result.examples ?? state.examples, loss: result.loss ?? null,
              publication: result.publication ?? state.publication, evaluation: result.evaluation ?? state.evaluation,
              reason: result.reason ?? 'Waiting for the next scheduled training job' };
            await saveLedger();
            logger.info('Training job completed', { ...state, model: result.published?.name || null });
          }
        } catch (error) {
          state = { ...state, status: 'error', error: error.message };
          logger.error('Training result persistence failed', { error: error.message });
        } finally {
          leases.clear();
          child = null;
          nextRun = Date.now() + config.intervalSeconds * 1000;
          resolve();
        }
      });
    });
  }

  async function cancel() {
    if (!child) return;
    const worker = child;
    worker.kill('SIGTERM');
    const timer = setTimeout(() => worker.kill('SIGKILL'), 5000);
    try { await completion; } finally { clearTimeout(timer); }
  }

  return {
    leases, start, tick, cancel,
    getState: () => ({ ...state, nextAttemptAt: nextRun || null, leasedSessions: leases.size,
      visitedSessions: Object.values(ledger).filter((entry) => entry.rounds).length,
      skippedSessions: Object.values(ledger).filter((entry) => entry.rejected).length,
      rejectionReasons: [...new Set(Object.values(ledger).filter((entry) => entry.rejected).map((entry) => entry.rejected))].slice(0, 10) }),
    stop: async () => { stopped = true; await cancel(); },
    kill: () => child?.kill('SIGKILL'),
  };
}

module.exports = { createTrainer };
