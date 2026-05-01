const { spawn } = require('child_process');
const EventEmitter = require('events');

const POLL_INTERVAL_MS = 1000;
const SCAN_TIMEOUT_MS = 2000;
const RECONNECT_DELAY_MS = 5000;

function parsePayloadLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  const quotedMatch = raw.match(/<<< "(.*)"$/);
  if (quotedMatch) return quotedMatch[1];
  if (raw.includes('AngleInDegrees,DistInMM,Intensity,ErrorCodeHEX')) {
    return 'AngleInDegrees,DistInMM,Intensity,ErrorCodeHEX';
  }
  const rotationMatch = raw.match(/ROTATION_SPEED,[0-9.]+/);
  if (rotationMatch) return rotationMatch[0];
  const pointMatch = raw.match(/\b\d+,\d+,\d+,[0-9A-Fa-f]+\b/);
  if (pointMatch) return pointMatch[0];
  return null;
}

function parsePointPayload(payload) {
  const match = String(payload || '').match(/^(\d+),(\d+),(\d+),([0-9A-Fa-f]+)$/);
  if (!match) return null;
  const angleDeg = Number(match[1]);
  const distanceMm = Number(match[2]);
  const intensity = Number(match[3]);
  const errorCodeHex = String(match[4]).toUpperCase();
  return {
    angleDeg,
    distanceMm,
    intensity,
    errorCodeHex,
    valid: errorCodeHex === '0' && distanceMm > 0,
  };
}

function parseRotationSpeed(payload) {
  const match = String(payload || '').match(/^ROTATION_SPEED,([0-9.]+)$/);
  if (!match) return null;
  return Number(match[1]);
}

function createLidarRuntime({ logger, host, port = 6053, key, shouldPoll, requestScan }) {
  const events = new EventEmitter();
  const state = {
    connected: false,
    process: null,
    reconnectTimer: null,
    pollTimer: null,
    stdoutBuffer: '',
    currentScan: null,
    requestInFlight: false,
    requestStartedAt: 0,
  };

  function emitStatus() {
    events.emit('status', { connected: state.connected });
  }

  function clearReconnectTimer() {
    if (!state.reconnectTimer) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      startLogStream();
    }, RECONNECT_DELAY_MS);
  }

  function resetScanState() {
    state.currentScan = null;
    state.requestInFlight = false;
    state.requestStartedAt = 0;
  }

  function finalizeScan() {
    if (!state.currentScan) {
      resetScanState();
      return;
    }
    const points = Array.from(state.currentScan.points.values()).sort((a, b) => a.angleDeg - b.angleDeg);
    const payload = {
      points,
      rotationSpeed: state.currentScan.rotationSpeed,
    };
    logger.info('Neato lidar scan parsed', { points: points.length, rotationSpeed: payload.rotationSpeed });
    resetScanState();
    events.emit('scan', payload);
  }

  function handlePayload(payload) {
    if (!payload) return;
    if (payload === 'AngleInDegrees,DistInMM,Intensity,ErrorCodeHEX') {
      state.currentScan = {
        points: new Map(),
        rotationSpeed: null,
      };
      return;
    }
    const rotationSpeed = parseRotationSpeed(payload);
    if (rotationSpeed != null) {
      if (state.currentScan) state.currentScan.rotationSpeed = rotationSpeed;
      finalizeScan();
      return;
    }
    const point = parsePointPayload(payload);
    if (!point || !state.currentScan) return;
    state.currentScan.points.set(point.angleDeg, point);
  }

  function handleStdoutChunk(chunk) {
    state.stdoutBuffer += String(chunk || '');
    const lines = state.stdoutBuffer.split(/\r?\n/);
    state.stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const payload = parsePayloadLine(line);
      handlePayload(payload);
    }
  }

  function teardownProcess() {
    const proc = state.process;
    state.process = null;
    state.connected = false;
    emitStatus();
    resetScanState();
    if (!proc) return;
    proc.removeAllListeners();
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
    try {
      proc.kill();
    } catch (err) {
      logger.warn('Failed to stop Neato lidar log process', err.message);
    }
  }

  function startLogStream() {
    if (!host || !key) return;
    if (state.process) return;

    const args = [
      '--from',
      'aioesphomeapi',
      'aioesphomeapi-logs',
      host,
      '--port',
      String(port || 6053),
      '--noise-psk',
      key,
      '--no-states',
    ];

    logger.info('Starting Neato lidar log stream', { host, port: Number(port || 6053) });
    const proc = spawn('uvx', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    state.process = proc;
    state.stdoutBuffer = '';

    proc.stdout.on('data', (chunk) => {
      if (!state.connected) {
        state.connected = true;
        emitStatus();
      }
      handleStdoutChunk(chunk);
    });

    proc.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) logger.warn('Neato lidar log stream stderr', message);
    });

    proc.on('close', (code, signal) => {
      logger.warn('Neato lidar log stream stopped', { code, signal });
      teardownProcess();
      scheduleReconnect();
    });

    proc.on('error', (err) => {
      logger.warn('Neato lidar log stream error', err.message);
      teardownProcess();
      scheduleReconnect();
    });
  }

  async function tickPoll() {
    if (!state.connected) return;
    if (!shouldPoll?.()) return;
    if (state.requestInFlight) {
      if (Date.now() - state.requestStartedAt >= SCAN_TIMEOUT_MS) {
        logger.warn('Neato lidar scan timed out; resetting parser state');
        resetScanState();
      }
      return;
    }
    state.requestInFlight = true;
    state.requestStartedAt = Date.now();
    try {
      await requestScan?.();
    } catch (err) {
      logger.warn('Failed to request Neato lidar scan', err.message);
      resetScanState();
    }
  }

  function start() {
    startLogStream();
    if (!state.pollTimer) {
      state.pollTimer = setInterval(() => {
        tickPoll();
      }, POLL_INTERVAL_MS);
    }
  }

  function stop() {
    clearReconnectTimer();
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    teardownProcess();
  }

  function getState() {
    return {
      connected: state.connected,
    };
  }

  return {
    start,
    stop,
    getState,
    on: (...args) => events.on(...args),
  };
}

module.exports = {
  createLidarRuntime,
};
