// Kinect Hardware Bridge
// Purpose: Owns the persistent native Kinect worker process and converts worker output into Socket.IO-ready payloads.
// Scope: Keeps libfreenect process management isolated from auth, cooldown, and browser delivery.
const { spawn } = require('child_process');
const path = require('path');
const sharp = require('sharp');

const WORKER_PATH = process.env.KINECT_WORKER || path.join(__dirname, 'native', 'kinect_worker');
const CAPTURE_TIMEOUT_MS = 12000;
const WORKER_STDERR_LOG_INTERVAL_MS = 5000;
const PROCESS_SIGNAL_EXIT_DELAY_MS = 1700;

let worker = null;
let stdoutBuffer = Buffer.alloc(0);
let pending = null;
let commandChain = Promise.resolve();
let nextCommandId = 1;
let lastWorkerStderr = '';
let lastWorkerStderrLogAt = 0;
let suppressedWorkerStderr = 0;

function resetWorker(child = worker) {
  // Child process events can arrive after a replacement worker has already
  // started.  Only clear module state when the event belongs to the current
  // process so a stale close event cannot tear down the live stream.
  if (child && worker && child !== worker) return;
  worker = null;
  stdoutBuffer = Buffer.alloc(0);
  pending = null;
}

function rejectPending(err) {
  if (!pending) return;
  const current = pending;
  pending = null;
  clearTimeout(current.timeout);
  current.reject(err);
}

function stopWorker() {
  if (!worker) return;
  const child = worker;
  resetWorker();
  child.kill('SIGTERM');
}

function parseWorkerStdout() {
  if (!pending) return;

  while (pending) {
    if (!pending.meta) {
      const newline = stdoutBuffer.indexOf(0x0a);
      if (newline === -1) return;
      try {
        pending.meta = JSON.parse(stdoutBuffer.slice(0, newline).toString('utf8'));
      } catch (err) {
        rejectPending(new Error(`kinect worker returned invalid metadata: ${err.message}`));
        return;
      }
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
    }

    const payloadBytes = Number(pending.meta.payloadBytes) || 0;
    if (stdoutBuffer.length < payloadBytes) return;
    const payload = stdoutBuffer.slice(0, payloadBytes);
    stdoutBuffer = stdoutBuffer.slice(payloadBytes);

    const current = pending;
    pending = null;
    clearTimeout(current.timeout);
    if (current.meta.id !== current.id) {
      current.reject(new Error('kinect worker response id mismatch'));
    } else if (!current.meta.ok) {
      current.reject(new Error(current.meta.error || 'kinect worker failed'));
    } else {
      current.resolve({ meta: current.meta, payload });
    }
  }
}

function ensureWorker() {
  if (worker && !worker.killed) {
    return worker;
  }

  lastWorkerStderr = '';
  const child = spawn(WORKER_PATH, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  worker = child;
  stdoutBuffer = Buffer.alloc(0);

  child.stdout.on('data', (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    parseWorkerStdout();
  });

  child.stderr.on('data', (chunk) => {
    // libfreenect logs diagnostic USB details to stderr.  Keep those details
    // available for the eventual close error, but throttle console output
    // because packet-loss messages can become repetitive on Kinect v1 hardware.
    const text = chunk.toString('utf8').trim();
    if (!text) return;
    lastWorkerStderr = text.split('\n').filter(Boolean).slice(-1)[0] || text;
    const now = Date.now();
    if (now - lastWorkerStderrLogAt >= WORKER_STDERR_LOG_INTERVAL_MS) {
      const suffix = suppressedWorkerStderr
        ? ` (${suppressedWorkerStderr} similar worker stderr messages suppressed)`
        : '';
      console.warn('[kinect worker]', `${text}${suffix}`);
      lastWorkerStderrLogAt = now;
      suppressedWorkerStderr = 0;
    } else {
      suppressedWorkerStderr += 1;
    }
  });

  child.on('error', (err) => {
    rejectPending(err);
    resetWorker(child);
  });

  child.on('close', (code, signal) => {
    const reason = signal || code;
    const detail = lastWorkerStderr ? `: ${lastWorkerStderr}` : '';
    rejectPending(new Error(`kinect worker exited (${reason})${detail}`));
    resetWorker(child);
  });

  return child;
}

function startWorker() {
  ensureWorker();
}

function sendWorkerCommand(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = ensureWorker();
    const id = nextCommandId;
    nextCommandId += 1;

    // The native worker frames stdout as "one response for one command", so
    // keeping only one in-flight command prevents interleaved binary payloads
    // and also avoids overlapping expensive point-cloud serialization.
    if (pending) {
      reject(new Error('kinect worker command already running'));
      return;
    }

    const timeout = setTimeout(() => {
      rejectPending(new Error('kinect worker timed out'));
      stopWorker();
    }, timeoutMs);

    pending = {
      id,
      meta: null,
      timeout,
      resolve,
      reject,
    };

    try {
      child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    } catch (err) {
      rejectPending(err);
      stopWorker();
    }
  });
}

function queueWorkerCommand(command, timeoutMs) {
  commandChain = commandChain
    .catch(() => {})
    .then(() => sendWorkerCommand(command, timeoutMs));
  return commandChain;
}

async function captureColorImage() {
  const { meta, payload } = await queueWorkerCommand({ mode: 'color' }, CAPTURE_TIMEOUT_MS);
  const jpeg = await sharp(payload, {
    raw: {
      width: meta.width,
      height: meta.height,
      channels: 3,
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  return {
    meta: {
      width: meta.width,
      height: meta.height,
      format: 'jpeg',
      frameAgeMs: meta.frameAgeMs,
    },
    buffer: jpeg,
  };
}

async function capturePointCloud() {
  const { meta, payload } = await queueWorkerCommand({ mode: 'pointcloud' }, CAPTURE_TIMEOUT_MS);
  return {
    meta: {
      width: meta.width,
      height: meta.height,
      pointCount: meta.pointCount,
      format: meta.format,
      grid: Boolean(meta.grid),
      strideBytes: 16,
      rgbFrameAgeMs: meta.rgbFrameAgeMs,
      depthFrameAgeMs: meta.depthFrameAgeMs,
    },
    buffer: payload,
  };
}

async function getWorkerStatus() {
  const { meta } = await queueWorkerCommand({ mode: 'status' }, CAPTURE_TIMEOUT_MS);
  return {
    hasRgb: Boolean(meta.hasRgb),
    hasDepth: Boolean(meta.hasDepth),
    rgbFrames: Number(meta.rgbFrames) || 0,
    depthFrames: Number(meta.depthFrames) || 0,
    validDepthPixels: Number(meta.validDepthPixels) || 0,
    rgbFrameAgeMs: meta.rgbFrameAgeMs ?? null,
    depthFrameAgeMs: meta.depthFrameAgeMs ?? null,
  };
}

function installShutdownHooks() {
  const shutdown = () => stopWorker();
  const exitAfterServiceCleanup = (code) => {
    // Several services install signal handlers that synchronously start cleanup
    // and schedule short force-kill fallbacks for child processes. Exiting here
    // immediately would prevent those timers from running, so the Kinect bridge
    // leaves a small process-wide grace window before forcing Node down.
    setTimeout(() => {
      process.exit(code);
    }, PROCESS_SIGNAL_EXIT_DELAY_MS);
  };
  process.once('exit', shutdown);
  process.once('SIGINT', () => {
    shutdown();
    exitAfterServiceCleanup(130);
  });
  process.once('SIGTERM', () => {
    shutdown();
    exitAfterServiceCleanup(143);
  });
}

installShutdownHooks();

module.exports = {
  startWorker,
  stopWorker,
  captureColorImage,
  capturePointCloud,
  getWorkerStatus,
};
