const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');

const SCAN_TIMEOUT_MS = 8000;
const RECONNECT_DELAY_MS = 5000;

function sanitizeLogText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

function parsePayloadLine(line) {
  const raw = sanitizeLogText(line).trim();
  if (!raw) return null;
  const quotedMatch = raw.match(/<<< "(.*)"$/);
  if (!quotedMatch) return null;
  const payload = quotedMatch[1];
  if (!payload) return null;

  // Ignore the duplicated multiline blob form and trust the clean one-message stream.
  if (payload.includes('\\r\\n') || payload.includes('\r') || payload.includes('\n')) {
    return null;
  }

  if (payload === 'AngleInDegrees,DistInMM,Intensity,ErrorCodeHEX') {
    return payload;
  }
  if (/^ROTATION_SPEED,[0-9.]+$/.test(payload)) {
    return payload;
  }
  if (/^\d+,\d+,\d+,[0-9A-Fa-f]+$/.test(payload)) {
    return payload;
  }
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

function createLidarRuntime({ logger, host, port = 6053, key, logFile = '', shouldPoll, requestScan }) {
  const events = new EventEmitter();
  const state = {
    connected: false,
    process: null,
    reconnectTimer: null,
    pollSoonTimer: null,
    requestTimeoutTimer: null,
    stdoutBuffer: '',
    stderrBuffer: '',
    currentScan: null,
    requestInFlight: false,
    requestStartedAt: 0,
    logStream: null,
    stats: {
      headersSeen: 0,
      rotationsSeen: 0,
      scansOk: 0,
      scansTimedOut: 0,
      scansRestarted: 0,
      rotationsWithoutScan: 0,
      parseablePayloads: 0,
      pointPayloads: 0,
    },
  };

  function emitStatus() {
    events.emit('status', { connected: state.connected });
  }

  function clearReconnectTimer() {
    if (!state.reconnectTimer) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  function clearPollSoonTimer() {
    if (!state.pollSoonTimer) return;
    clearTimeout(state.pollSoonTimer);
    state.pollSoonTimer = null;
  }

  function clearRequestTimeoutTimer() {
    if (!state.requestTimeoutTimer) return;
    clearTimeout(state.requestTimeoutTimer);
    state.requestTimeoutTimer = null;
  }

  function triggerPollSoon() {
    if (state.pollSoonTimer) return;
    state.pollSoonTimer = setTimeout(() => {
      state.pollSoonTimer = null;
      tickPoll();
    }, 0);
  }

  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      startLogStream();
    }, RECONNECT_DELAY_MS);
  }

  function resetScanState() {
    clearRequestTimeoutTimer();
    state.currentScan = null;
    state.requestInFlight = false;
    state.requestStartedAt = 0;
  }

  function buildPoints(scan) {
    return Array.from(scan?.points?.values?.() || []).sort((a, b) => a.angleDeg - b.angleDeg);
  }

  function emitFrame({ status, reason, scan = state.currentScan }) {
    const points = buildPoints(scan);
    const payload = {
      points,
      rotationSpeed: scan?.rotationSpeed ?? null,
      status,
      debug: {
        reason,
        pointsReceived: points.length,
        validPoints: points.filter((point) => point?.valid).length,
        requestInFlight: state.requestInFlight,
        requestStartedAt: state.requestStartedAt || null,
        stats: { ...state.stats },
      },
    };
    events.emit('scan', payload);
    return payload;
  }

  function finalizeScan(reason = 'rotation_complete') {
    if (!state.currentScan) {
      state.stats.rotationsWithoutScan += 1;
      emitFrame({ status: 'error', reason: 'rotation_without_scan', scan: null });
      resetScanState();
      return;
    }
    state.stats.scansOk += 1;
    const payload = emitFrame({ status: 'ok', reason });
    logger.info('Neato lidar scan parsed', {
      points: payload.points.length,
      rotationSpeed: payload.rotationSpeed,
      reason,
    });
    resetScanState();
    triggerPollSoon();
  }

  function handlePayload(payload) {
    if (!payload) return;
    state.stats.parseablePayloads += 1;
    if (payload === 'AngleInDegrees,DistInMM,Intensity,ErrorCodeHEX') {
      state.stats.headersSeen += 1;
      if (state.currentScan) {
        state.stats.scansRestarted += 1;
        emitFrame({ status: 'error', reason: 'header_restart' });
      }
      state.currentScan = {
        points: new Map(),
        rotationSpeed: null,
      };
      return;
    }
    const rotationSpeed = parseRotationSpeed(payload);
    if (rotationSpeed != null) {
      state.stats.rotationsSeen += 1;
      if (state.currentScan) {
        state.currentScan.rotationSpeed = rotationSpeed;
      }
      finalizeScan('rotation_complete');
      return;
    }
    const point = parsePointPayload(payload);
    if (!point || !state.currentScan) return;
    state.stats.pointPayloads += 1;
    state.currentScan.points.set(point.angleDeg, point);
  }

  function handleTextChunk(chunk, bufferKey, sourceLabel = '') {
    const text = String(chunk || '');
    if (state.logStream) {
      const prefix = sourceLabel ? `[${sourceLabel}] ` : '';
      state.logStream.write(
        text
          .split(/\r?\n/)
          .map((line, index, parts) => (index === parts.length - 1 && line === '' ? '' : `${prefix}${line}`))
          .join('\n'),
      );
    }
    state[bufferKey] += sanitizeLogText(text);
    const lines = state[bufferKey].split(/\r?\n/);
    state[bufferKey] = lines.pop() || '';
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

  function ensureLogStream() {
    if (!logFile || state.logStream) return;
    try {
      state.logStream = fs.createWriteStream(logFile, { flags: 'a' });
      logger.info('Neato lidar raw log capture enabled', { logFile });
    } catch (err) {
      logger.warn('Failed to open Neato lidar raw log file', { logFile, error: err.message });
      state.logStream = null;
    }
  }

  function closeLogStream() {
    if (!state.logStream) return;
    try {
      state.logStream.end();
    } catch (err) {
      logger.warn('Failed to close Neato lidar raw log file', err.message);
    }
    state.logStream = null;
  }

  function startLogStream() {
    if (!host || !key) return;
    if (state.process) return;
    ensureLogStream();

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
        triggerPollSoon();
      }
      handleTextChunk(chunk, 'stdoutBuffer', 'stdout');
    });

    proc.stderr.on('data', (chunk) => {
      handleTextChunk(chunk, 'stderrBuffer', 'stderr');
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
    if (state.requestInFlight) return;
    state.requestInFlight = true;
    state.requestStartedAt = Date.now();
    clearRequestTimeoutTimer();
    state.requestTimeoutTimer = setTimeout(() => {
      logger.warn('Neato lidar scan timed out; resetting parser state');
      state.stats.scansTimedOut += 1;
      emitFrame({ status: 'error', reason: 'scan_timeout' });
      resetScanState();
      triggerPollSoon();
    }, SCAN_TIMEOUT_MS);
    try {
      await requestScan?.();
    } catch (err) {
      logger.warn('Failed to request Neato lidar scan', err.message);
      resetScanState();
      triggerPollSoon();
    }
  }

  function start() {
    startLogStream();
    triggerPollSoon();
  }

  function stop() {
    clearReconnectTimer();
    clearPollSoonTimer();
    clearRequestTimeoutTimer();
    teardownProcess();
    closeLogStream();
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
