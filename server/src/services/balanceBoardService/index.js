// Balance Board Service
// Purpose: Turns calibrated corner loads into an automatic rover weigh-station lifecycle.
// Scope: Owns configuration, tare/stability policy, session state, Socket.IO delivery, persistence, and admin maintenance actions.
const fs = require('fs');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('balanceBoardService');
const { loadConfig } = require('../../helpers/configLoader');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const { isFeatureEnabled } = require('../../helpers/features');
const { isAdmin } = require('../roleService');
const { publishEvent } = require('../eventBus');
const { createBalanceBoardHardware } = require('./hardware');

const events = new EventEmitter();
const config = loadConfig();
const rawConfig = config.balanceBoard || {};
const enabled = isFeatureEnabled('balanceBoard');
const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('balance-board.json');
const FRAME_ROOM = 'balance-board-viewers';
const TARE_SAMPLE_COUNT = 20;
const MAX_TARE_WEIGHT_KG = 2;
const DEFAULTS = {
  minimumWeightKg: 1,
  stableDurationMs: 1500,
  stableToleranceKg: 0.15,
  exitWeightKg: 0.35,
  disconnectWhenEmptyMs: 30000,
};

function finiteNumber(value, fallback, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

const settings = {
  minimumWeightKg: finiteNumber(rawConfig.minimumWeightKg, DEFAULTS.minimumWeightKg, 0.1, 100),
  stableDurationMs: finiteNumber(rawConfig.stableDurationMs, DEFAULTS.stableDurationMs, 250, 10000),
  stableToleranceKg: finiteNumber(rawConfig.stableToleranceKg, DEFAULTS.stableToleranceKg, 0.01, 5),
  exitWeightKg: finiteNumber(rawConfig.exitWeightKg, DEFAULTS.exitWeightKg, 0, 20),
  disconnectWhenEmptyMs: finiteNumber(
    rawConfig.disconnectWhenEmptyMs,
    DEFAULTS.disconnectWhenEmptyMs,
    0,
    30 * 60 * 1000,
  ),
  // Simulation is intentionally undocumented in the public example config.
  // It exists for development and CI where no Bluetooth board is attached.
  simulate: Boolean(rawConfig.simulate || process.env.BALANCE_BOARD_SIMULATE),
};

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const address = typeof parsed?.address === 'string' ? parsed.address.trim().toUpperCase() : '';
    return { address };
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('Failed to load Balance Board store', err.message);
    return { address: '' };
  }
}

let store = enabled ? loadStore() : { address: '' };
let hardware = null;
let phase = enabled ? (store.address ? 'waiting' : 'commissioning') : 'disabled';
let hardwareState = enabled ? 'starting' : 'disabled';
let connected = false;
let lastError = null;
let batteryPercent = null;
let latestFrame = null;
let lastMeasurement = null;
let tareSamples = [];
let tare = { topRight: 0, bottomRight: 0, topLeft: 0, bottomLeft: 0 };
let stableSamples = [];
let emptySince = null;
let disconnectRequested = false;

function persistStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const next = {
    address: store.address || '',
    updatedAt: Date.now(),
  };
  const temporary = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, STORE_PATH);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeCorners(raw = {}) {
  // The native bridge reports centi-kilograms because that is the calibrated
  // unit produced by hid-wiimote. Convert once at the service boundary so every
  // browser and future event consumer receives ordinary kilograms.
  return {
    topRight: Math.max(0, Number(raw.topRight) || 0) / 100,
    bottomRight: Math.max(0, Number(raw.bottomRight) || 0) / 100,
    topLeft: Math.max(0, Number(raw.topLeft) || 0) / 100,
    bottomLeft: Math.max(0, Number(raw.bottomLeft) || 0) / 100,
  };
}

function applyTare(corners) {
  return {
    topRight: Math.max(0, corners.topRight - tare.topRight),
    bottomRight: Math.max(0, corners.bottomRight - tare.bottomRight),
    topLeft: Math.max(0, corners.topLeft - tare.topLeft),
    bottomLeft: Math.max(0, corners.bottomLeft - tare.bottomLeft),
  };
}

function describeLoad(corners) {
  const totalKg = corners.topRight + corners.bottomRight + corners.topLeft + corners.bottomLeft;
  if (totalKg <= 0.001) return { totalKg: 0, center: { x: 0, y: 0 } };
  const right = corners.topRight + corners.bottomRight;
  const left = corners.topLeft + corners.bottomLeft;
  const top = corners.topRight + corners.topLeft;
  const bottom = corners.bottomRight + corners.bottomLeft;
  return {
    totalKg: round(totalKg, 2),
    // Normalized -1..1 coordinates make the browser independent of the board's
    // physical dimensions while retaining the full centering information.
    center: {
      x: round((right - left) / totalKg, 3),
      y: round((bottom - top) / totalKg, 3),
    },
  };
}

function getState() {
  return {
    enabled,
    paired: Boolean(store.address) || settings.simulate,
    address: store.address || (settings.simulate ? 'SIMULATED' : null),
    connected,
    hardwareState,
    phase,
    batteryPercent,
    lastError,
    lastMeasurement,
    settings: {
      minimumWeightKg: settings.minimumWeightKg,
      stableDurationMs: settings.stableDurationMs,
    },
  };
}

function emitStateChange(reason) {
  events.emit('change', { reason, state: getState() });
}

function setPhase(next, reason = next) {
  if (phase === next) return;
  phase = next;
  emitStateChange(reason);
}

function resetMeasurementCycle() {
  stableSamples = [];
  emptySince = Date.now();
  disconnectRequested = false;
  setPhase('waiting', 'station-empty');
}

function beginTare() {
  tareSamples = [];
  stableSamples = [];
  tare = { topRight: 0, bottomRight: 0, topLeft: 0, bottomLeft: 0 };
  setPhase('zeroing', 'tare-started');
}

function finishTare() {
  if (!tareSamples.length) return;
  const totals = tareSamples.reduce(
    (sum, sample) => ({
      topRight: sum.topRight + sample.topRight,
      bottomRight: sum.bottomRight + sample.bottomRight,
      topLeft: sum.topLeft + sample.topLeft,
      bottomLeft: sum.bottomLeft + sample.bottomLeft,
    }),
    { topRight: 0, bottomRight: 0, topLeft: 0, bottomLeft: 0 },
  );
  tare = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, value / tareSamples.length]),
  );
  tareSamples = [];
  resetMeasurementCycle();
}

function isStable(samples) {
  if (samples.length < 2) return false;
  const duration = samples[samples.length - 1].ts - samples[0].ts;
  if (duration < settings.stableDurationMs) return false;
  const weights = samples.map((sample) => sample.totalKg);
  if (Math.max(...weights) - Math.min(...weights) > settings.stableToleranceKg) return false;

  const centerXs = samples.map((sample) => sample.center.x);
  const centerYs = samples.map((sample) => sample.center.y);
  if (Math.max(...centerXs) - Math.min(...centerXs) > 0.06) return false;
  if (Math.max(...centerYs) - Math.min(...centerYs) > 0.06) return false;

  // Total weight can remain constant while a rover is still rolling from one
  // side to the other. Requiring every load cell to settle prevents that motion
  // from being mistaken for a stable measurement.
  return ['topRight', 'bottomRight', 'topLeft', 'bottomLeft'].every((corner) => {
    const values = samples.map((sample) => sample.corners[corner]);
    return Math.max(...values) - Math.min(...values) <= settings.stableToleranceKg;
  });
}

function captureMeasurement(frame) {
  lastMeasurement = {
    totalKg: frame.totalKg,
    corners: frame.corners,
    center: frame.center,
    capturedAt: frame.ts,
  };
  setPhase('captured', 'measurement-captured');
  publishEvent({
    source: 'balanceBoard',
    type: 'balanceBoard.measurement',
    payload: lastMeasurement,
  });
  logger.info('Balance Board measurement captured', {
    totalKg: lastMeasurement.totalKg,
    center: lastMeasurement.center,
  });
}

function processFrame(message = {}) {
  if (!connected) {
    connected = true;
    hardwareState = 'connected';
    lastError = null;
    beginTare();
    emitStateChange('hardware-connected');
  }

  const rawCorners = normalizeCorners(message.corners);
  const rawLoad = describeLoad(rawCorners);
  if (Number.isFinite(Number(message.batteryPercent))) {
    batteryPercent = Math.max(0, Math.min(100, Number(message.batteryPercent)));
  }

  if (phase === 'zeroing') {
    // Power is normally pressed before a rover approaches, making connection
    // time the safest automatic zero point. Refuse an obviously loaded board so
    // a rover already parked on it cannot be silently subtracted as the tare.
    if (rawLoad.totalKg <= MAX_TARE_WEIGHT_KG) tareSamples.push(rawCorners);
    if (tareSamples.length >= TARE_SAMPLE_COUNT) finishTare();
  }

  const corners = applyTare(rawCorners);
  const load = describeLoad(corners);
  const frame = {
    ts: Date.now(),
    corners: Object.fromEntries(Object.entries(corners).map(([key, value]) => [key, round(value, 2)])),
    totalKg: load.totalKg,
    center: load.center,
    batteryPercent,
    phase,
  };
  latestFrame = frame;
  io.to(FRAME_ROOM).emit('balanceBoard:frame', frame);

  if (phase === 'zeroing') return;
  if (frame.totalKg <= settings.exitWeightKg) {
    if (phase !== 'waiting') resetMeasurementCycle();
    if (!emptySince) emptySince = frame.ts;
    if (
      settings.disconnectWhenEmptyMs > 0 &&
      !disconnectRequested &&
      frame.ts - emptySince >= settings.disconnectWhenEmptyMs
    ) {
      // `disconnect` is advisory: genuine boards normally power down after the
      // HID connection closes. If a firmware clone ignores it, the station
      // remains safe and simply continues reporting an empty connected board.
      disconnectRequested = true;
      try {
        hardware?.send('disconnect');
      } catch (err) {
        logger.warn('Failed to request Balance Board idle disconnect', err.message);
      }
    }
    return;
  }

  emptySince = null;
  if (phase === 'captured') return;
  if (frame.totalKg < settings.minimumWeightKg) {
    stableSamples = [];
    setPhase('entering', 'load-entering');
    return;
  }

  if (phase !== 'stabilizing') setPhase('stabilizing', 'load-detected');
  stableSamples.push({
    ts: frame.ts,
    totalKg: frame.totalKg,
    center: frame.center,
    corners: frame.corners,
  });
  // Retain one frame of scheduling slack. If we removed everything older than
  // the exact window first, a 20 Hz stream would usually keep only 1450 ms of
  // history and could therefore approach but never satisfy a 1500 ms window.
  const cutoff = frame.ts - settings.stableDurationMs - 100;
  stableSamples = stableSamples.filter((sample) => sample.ts >= cutoff);
  if (isStable(stableSamples)) captureMeasurement(frame);
}

function handleWorkerMessage(message = {}) {
  if (message.type === 'frame') {
    processFrame(message);
    return;
  }
  if (message.type === 'paired') {
    const address = typeof message.address === 'string' ? message.address.trim().toUpperCase() : '';
    if (address && address !== store.address) {
      store.address = address;
      persistStore();
    }
    hardware?.setAddress(address);
    hardwareState = 'waiting';
    lastError = null;
    setPhase('waiting', 'board-paired');
    emitStateChange('board-paired');
    return;
  }
  if (message.type !== 'status') return;

  hardwareState = String(message.state || 'unknown');
  lastError = message.error ? String(message.error) : null;
  if (hardwareState === 'connected') {
    if (!connected) {
      connected = true;
      beginTare();
    }
  } else {
    connected = false;
    latestFrame = null;
    tareSamples = [];
    stableSamples = [];
    if (hardwareState === 'commissioning' || hardwareState === 'pairing') {
      setPhase(hardwareState, hardwareState);
    } else if (hardwareState === 'error') {
      setPhase('error', 'hardware-error');
    } else {
      setPhase(store.address || settings.simulate ? 'waiting' : 'commissioning', 'hardware-waiting');
    }
  }
  emitStateChange('hardware-status');
}

function requireAdmin(socket) {
  if (!isAdmin(socket)) throw new Error('Not authorized for Balance Board maintenance');
  if (!enabled) throw new Error('Balance Board support is disabled');
}

io.on('connection', (socket) => {
  socket.on('balanceBoard:subscribe', (_payload = {}, cb = () => {}) => {
    socket.join(FRAME_ROOM);
    if (latestFrame) socket.emit('balanceBoard:frame', latestFrame);
    cb({ success: true });
  });
  socket.on('balanceBoard:unsubscribe', () => socket.leave(FRAME_ROOM));

  socket.on('balanceBoard:tare', (_payload = {}, cb = () => {}) => {
    try {
      requireAdmin(socket);
      if (!connected) throw new Error('Balance Board is not connected');
      beginTare();
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('balanceBoard:pair', (_payload = {}, cb = () => {}) => {
    try {
      requireAdmin(socket);
      hardware?.send('pair');
      store.address = '';
      hardware?.setAddress('');
      persistStore();
      setPhase('commissioning', 'pairing-requested');
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('balanceBoard:forget', (_payload = {}, cb = () => {}) => {
    try {
      requireAdmin(socket);
      hardware?.send('forget');
      store.address = '';
      hardware?.setAddress('');
      persistStore();
      setPhase('commissioning', 'board-forgotten');
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('balanceBoard:restart', (_payload = {}, cb = () => {}) => {
    try {
      requireAdmin(socket);
      hardware?.restart();
      hardwareState = 'starting';
      emitStateChange('worker-restarted');
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

if (enabled) {
  hardware = createBalanceBoardHardware({
    logger,
    address: store.address,
    simulate: settings.simulate,
  });
  hardware.events.on('message', handleWorkerMessage);
  hardware.start();
} else {
  logger.info('Balance Board disabled by config');
}

function installShutdownHooks() {
  const shutdown = () => hardware?.stop();
  process.once('exit', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

installShutdownHooks();

module.exports = {
  getState,
  balanceBoardEvents: events,
};
