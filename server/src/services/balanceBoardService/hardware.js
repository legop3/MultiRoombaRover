// Balance Board Hardware Bridge
// Purpose: Supervises the capability-limited native worker and converts its JSON-line protocol into service events.
// Scope: Owns process lifecycle, restart recovery, worker commands, and protocol validation; measurement policy remains in index.js.
const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');

const WORKER_PATH =
  process.env.BALANCE_BOARD_WORKER ||
  path.join(__dirname, 'native', 'balance_board_worker');
const RESTART_DELAY_MS = 2000;
const STDERR_LOG_INTERVAL_MS = 5000;

function createBalanceBoardHardware({ logger, address = '', simulate = false } = {}) {
  const events = new EventEmitter();
  let worker = null;
  let stdoutBuffer = '';
  let stopped = false;
  let restartTimer = null;
  let lastStderrLogAt = 0;
  let suppressedStderrLines = 0;
  let currentAddress = address;

  function emitProtocolError(message) {
    events.emit('message', {
      type: 'status',
      state: 'error',
      error: message,
    });
  }

  function processStdout(chunk) {
    stdoutBuffer += chunk.toString('utf8');
    let newline = stdoutBuffer.indexOf('\n');
    while (newline !== -1) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
            throw new Error('message needs a type');
          }
          events.emit('message', message);
        } catch (err) {
          // A corrupted stdout line means measurement framing can no longer be
          // trusted. Surface the exact line rather than silently discarding a
          // potential hardware failure that would otherwise look like zero kg.
          emitProtocolError(`balance board worker returned invalid JSON: ${err.message}`);
          logger?.warn?.('Balance Board worker protocol error', { line, error: err.message });
        }
      }
      newline = stdoutBuffer.indexOf('\n');
    }
  }

  function scheduleRestart() {
    if (stopped || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
    }, RESTART_DELAY_MS);
  }

  function start() {
    if (stopped || (worker && !worker.killed)) return;
    stdoutBuffer = '';

    const child = spawn(WORKER_PATH, [], {
      env: {
        ...process.env,
        BALANCE_BOARD_ADDRESS: currentAddress || '',
        BALANCE_BOARD_SIMULATE: simulate ? 'cycle' : '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    worker = child;

    child.stdout.on('data', processStdout);
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (!text) return;
      const now = Date.now();
      if (now - lastStderrLogAt >= STDERR_LOG_INTERVAL_MS) {
        const suffix = suppressedStderrLines
          ? ` (${suppressedStderrLines} worker stderr lines suppressed)`
          : '';
        logger?.warn?.(`Balance Board worker: ${text}${suffix}`);
        lastStderrLogAt = now;
        suppressedStderrLines = 0;
      } else {
        suppressedStderrLines += 1;
      }
    });
    child.on('error', (err) => {
      if (worker === child) worker = null;
      emitProtocolError(`balance board worker failed to start: ${err.message}`);
      scheduleRestart();
    });
    child.on('close', (code, signal) => {
      if (worker === child) worker = null;
      if (!stopped) {
        emitProtocolError(`balance board worker exited (${signal || code})`);
        scheduleRestart();
      }
    });
  }

  function send(command, payload = {}) {
    if (!worker || worker.killed || !worker.stdin?.writable) {
      throw new Error('balance board worker is not running');
    }
    // Commands are intentionally a tiny fixed vocabulary. The native worker
    // never accepts shell fragments or arbitrary Bluetooth addresses from the
    // browser, so an admin maintenance action cannot become command execution.
    worker.stdin.write(`${JSON.stringify({ command, ...payload })}\n`);
  }

  function stop() {
    stopped = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (!worker) return;
    const child = worker;
    worker = null;
    try {
      child.stdin.write(`${JSON.stringify({ command: 'stop' })}\n`);
    } catch (_err) {
      // The worker may have already closed stdin while its exit event is still
      // queued. SIGTERM below remains the reliable cleanup path.
    }
    child.kill('SIGTERM');
    setTimeout(() => {
      // bluetoothctl may still be finishing a bounded pairing command inside a
      // worker thread. Do not let that delay server shutdown indefinitely.
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
    }, 1500).unref();
  }

  function restart() {
    if (worker) {
      const child = worker;
      worker = null;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
      }, 1500).unref();
    }
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
    }, 250);
  }

  return {
    events,
    start,
    stop,
    restart,
    send,
    setAddress(nextAddress) {
      // The factory can be created before first commissioning. Preserve the
      // newly paired address for later bridge restarts in the same Node process
      // instead of reverting the replacement worker to discovery mode.
      currentAddress = typeof nextAddress === 'string' ? nextAddress.trim().toUpperCase() : '';
    },
  };
}

module.exports = {
  createBalanceBoardHardware,
};
