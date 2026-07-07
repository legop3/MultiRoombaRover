// odometer Service
// Purpose: Converts Roomba wheel encoder samples into persistent rover distance totals.
// Scope: Owns encoder rollover handling, sanity filtering, per-rover odometer state, and disk persistence.
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { resolveDataPath } = require('../../helpers/dataPaths');
const logger = require('../../globals/logger').child('odometerService');

const STORE_PATH = resolveDataPath('rover-odometers.json');
const ENCODER_MODULUS = 65536;
const ENCODER_HALF_RANGE = ENCODER_MODULUS / 2;
const DEFAULT_WHEEL_DIAMETER_MM = 72.0;
const DEFAULT_COUNTS_PER_REVOLUTION = 508.8;
const DEFAULT_MM_PER_COUNT = (Math.PI * DEFAULT_WHEEL_DIAMETER_MM) / DEFAULT_COUNTS_PER_REVOLUTION;
const DEFAULT_CALIBRATION_MULTIPLIER = 1;
const MAX_REASONABLE_SPEED_MM_PER_SECOND = 1200;
const MAX_REASONABLE_DELTA_FLOOR_MM = 250;
const SAVE_DEBOUNCE_MS = 2500;
const MIN_SAVE_INTERVAL_MS = 10000;
const EMIT_THROTTLE_MS = 500;

const odometerEvents = new EventEmitter();
const states = new Map();
let saveTimer = null;
let lastSaveAt = 0;
let loaded = false;

function nowMs() {
  return Date.now();
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStoredEntry(entry = {}) {
  const totalMm = Math.max(0, safeNumber(entry.totalMm, 0));
  const calibrationMultiplier = Math.max(0.01, safeNumber(entry.calibrationMultiplier, DEFAULT_CALIBRATION_MULTIPLIER));
  return {
    totalMm,
    calibrationMultiplier,
    updatedAt: safeNumber(entry.updatedAt, null),
  };
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const rovers = raw && typeof raw === 'object' && raw.rovers && typeof raw.rovers === 'object'
      ? raw.rovers
      : raw;
    Object.entries(rovers || {}).forEach(([roverId, entry]) => {
      const normalized = normalizeStoredEntry(entry);
      states.set(String(roverId), {
        roverId: String(roverId),
        totalMm: normalized.totalMm,
        sessionMm: 0,
        calibrationMultiplier: normalized.calibrationMultiplier,
        lastLeftCount: null,
        lastRightCount: null,
        lastSampleAt: null,
        lastIntegratedAt: null,
        lastDelta: null,
        wheelSpeedsMmPerSecond: {
          left: null,
          right: null,
          center: null,
        },
        rolloverEvents: 0,
        ignoredSamples: 0,
        status: 'waiting',
        statusReason: 'waiting for encoder sample',
        lastEmittedAt: 0,
        lastEmittedStatus: null,
        updatedAt: normalized.updatedAt,
      });
    });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load rover odometers', { path: STORE_PATH, error: err.message });
    }
  }
}

function ensureState(roverId) {
  ensureLoaded();
  const id = String(roverId || '').trim();
  if (!id) return null;
  if (!states.has(id)) {
    states.set(id, {
      roverId: id,
      totalMm: 0,
      sessionMm: 0,
      calibrationMultiplier: DEFAULT_CALIBRATION_MULTIPLIER,
      lastLeftCount: null,
      lastRightCount: null,
      lastSampleAt: null,
      lastIntegratedAt: null,
      lastDelta: null,
      wheelSpeedsMmPerSecond: {
        left: null,
        right: null,
        center: null,
      },
      rolloverEvents: 0,
      ignoredSamples: 0,
      status: 'waiting',
      statusReason: 'waiting for encoder sample',
      lastEmittedAt: 0,
      lastEmittedStatus: null,
      updatedAt: null,
    });
  }
  return states.get(id);
}

function signedEncoderDelta(previous, current) {
  let delta = current - previous;
  if (delta > ENCODER_HALF_RANGE) {
    delta -= ENCODER_MODULUS;
  } else if (delta < -ENCODER_HALF_RANGE) {
    delta += ENCODER_MODULUS;
  }
  return delta;
}

function crossedRollover(previous, current, delta) {
  // The unwrapped delta is intentionally compared with the raw subtraction.
  // If they differ, the encoder crossed the signed 16-bit boundary between
  // samples and the modular correction above was required.
  return current - previous !== delta;
}

function maxReasonableDeltaMm(elapsedMs) {
  const elapsedSeconds = Math.max(0.05, safeNumber(elapsedMs, 0) / 1000);
  return Math.max(MAX_REASONABLE_DELTA_FLOOR_MM, elapsedSeconds * MAX_REASONABLE_SPEED_MM_PER_SECOND);
}

function persistSoon() {
  const elapsed = nowMs() - lastSaveAt;
  if (elapsed >= MIN_SAVE_INTERVAL_MS) {
    saveNow();
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, Math.max(SAVE_DEBOUNCE_MS, MIN_SAVE_INTERVAL_MS - elapsed));
}

function saveNow() {
  ensureLoaded();
  const rovers = {};
  for (const [roverId, state] of states.entries()) {
    rovers[roverId] = {
      totalMm: Math.round(state.totalMm * 1000) / 1000,
      calibrationMultiplier: state.calibrationMultiplier,
      updatedAt: state.updatedAt || null,
    };
  }
  const payload = {
    version: 1,
    unit: 'millimeters',
    source: 'roomba wheel encoders',
    mmPerCount: DEFAULT_MM_PER_COUNT,
    rovers,
  };
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const tempPath = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, STORE_PATH);
    lastSaveAt = nowMs();
  } catch (err) {
    logger.warn('Failed to save rover odometers', { path: STORE_PATH, error: err.message });
  }
}

function snapshotState(state) {
  if (!state) return null;
  return {
    roverId: state.roverId,
    totalMm: Math.round(state.totalMm),
    sessionMm: Math.round(state.sessionMm),
    calibrationMultiplier: state.calibrationMultiplier,
    mmPerCount: DEFAULT_MM_PER_COUNT * state.calibrationMultiplier,
    rawMmPerCount: DEFAULT_MM_PER_COUNT,
    countsPerRevolution: DEFAULT_COUNTS_PER_REVOLUTION,
    wheelDiameterMm: DEFAULT_WHEEL_DIAMETER_MM,
    lastLeftCount: state.lastLeftCount,
    lastRightCount: state.lastRightCount,
    lastSampleAt: state.lastSampleAt,
    lastIntegratedAt: state.lastIntegratedAt,
    lastDelta: state.lastDelta,
    wheelSpeedsMmPerSecond: state.wheelSpeedsMmPerSecond || {
      left: null,
      right: null,
      center: null,
    },
    rolloverEvents: state.rolloverEvents,
    ignoredSamples: state.ignoredSamples,
    status: state.status,
    statusReason: state.statusReason,
    updatedAt: state.updatedAt,
  };
}

function emitSnapshot(state, snapshot, options = {}) {
  const force = Boolean(options.force);
  const emittedRecently = nowMs() - safeNumber(state.lastEmittedAt, 0) < EMIT_THROTTLE_MS;
  const statusChanged = state.lastEmittedStatus !== state.status;
  if (!force && emittedRecently && !statusChanged) return;

  // Odometer updates are presentation data, not control-loop data. Throttling
  // here keeps browser traffic proportional to what humans can read while the
  // integration math above still processes every sensor frame.
  state.lastEmittedAt = nowMs();
  state.lastEmittedStatus = state.status;
  odometerEvents.emit('update', { roverId: state.roverId, odometer: snapshot });
}

function getSnapshot(roverId) {
  return snapshotState(ensureState(roverId));
}

function getSnapshots(roverIds = null) {
  ensureLoaded();
  const ids = Array.isArray(roverIds) ? roverIds.map((id) => String(id)) : Array.from(states.keys());
  return ids.map((id) => snapshotState(ensureState(id))).filter(Boolean);
}

function processSensorFrame(roverId, sensors = {}) {
  const state = ensureState(roverId);
  if (!state) return null;
  const left = Number(sensors?.encoderCountsLeft);
  const right = Number(sensors?.encoderCountsRight);
  const sampleAt = nowMs();
  if (!Number.isInteger(left) || !Number.isInteger(right)) {
    state.status = 'waiting';
    state.statusReason = 'encoder counts missing';
    /*
      Speed is derived from consecutive encoder samples. When either encoder is
      absent, keeping stale speed values would make the socket payload look like
      a live sensor even though the required source data is missing.
    */
    state.wheelSpeedsMmPerSecond = {
      left: null,
      right: null,
      center: null,
    };
    return snapshotState(state);
  }

  if (state.lastLeftCount == null || state.lastRightCount == null) {
    // The first valid frame becomes the baseline because encoder packets are
    // cumulative counters inside the Roomba, not distance-since-last-poll
    // packets. Adding the first absolute value would invent mileage whenever
    // the server or rover reconnects.
    state.lastLeftCount = left;
    state.lastRightCount = right;
    state.lastSampleAt = sampleAt;
    state.status = 'tracking';
    state.statusReason = 'baseline ready';
    /*
      The baseline frame has valid encoder positions, but no previous sample to
      compare against. Reporting zero here is intentional: it gives clients a
      stable wheel-speed sensor shape immediately without inventing movement.
    */
    state.wheelSpeedsMmPerSecond = {
      left: 0,
      right: 0,
      center: 0,
    };
    state.updatedAt = sampleAt;
    const snapshot = snapshotState(state);
    emitSnapshot(state, snapshot, { force: true });
    return snapshot;
  }

  const leftCounts = signedEncoderDelta(state.lastLeftCount, left);
  const rightCounts = signedEncoderDelta(state.lastRightCount, right);
  const elapsedMs = state.lastSampleAt ? sampleAt - state.lastSampleAt : 0;
  const mmPerCount = DEFAULT_MM_PER_COUNT * state.calibrationMultiplier;
  const leftMm = leftCounts * mmPerCount;
  const rightMm = rightCounts * mmPerCount;
  const centerMm = (leftMm + rightMm) / 2;
  const distanceMm = Math.abs(centerMm);
  const reasonableLimit = maxReasonableDeltaMm(elapsedMs);
  const leftRolled = crossedRollover(state.lastLeftCount, left, leftCounts);
  const rightRolled = crossedRollover(state.lastRightCount, right, rightCounts);
  const elapsedSeconds = elapsedMs > 0 ? elapsedMs / 1000 : null;
  /*
    The Roomba Open Interface encoder packets are cumulative wheel counts. The
    odometer already converts each signed count delta into millimeters using the
    configured Create wheel diameter/counts-per-revolution constants, so wheel
    speed is the same per-wheel millimeter delta divided by the wall-clock time
    between accepted sensor frames.
  */
  const rawWheelSpeedsMmPerSecond = elapsedSeconds
    ? {
        left: leftMm / elapsedSeconds,
        right: rightMm / elapsedSeconds,
        center: centerMm / elapsedSeconds,
      }
    : {
        left: 0,
        right: 0,
        center: 0,
      };
  const wheelSpeedsMmPerSecond = {
    left: Math.round(rawWheelSpeedsMmPerSecond.left),
    right: Math.round(rawWheelSpeedsMmPerSecond.right),
    center: Math.round(rawWheelSpeedsMmPerSecond.center),
  };

  state.lastLeftCount = left;
  state.lastRightCount = right;
  state.lastSampleAt = sampleAt;
  if (leftRolled) state.rolloverEvents += 1;
  if (rightRolled) state.rolloverEvents += 1;

  if (distanceMm > reasonableLimit) {
    // A single impossible jump is much more likely to be stale serial data,
    // a reconnect edge, or corrupt parsing than real movement. The baseline is
    // still advanced so the next good frame can continue from the new counter.
    state.ignoredSamples += 1;
    state.status = 'ignored';
    state.statusReason = `ignored ${Math.round(distanceMm)} mm jump`;
    /*
      Rejected encoder jumps are deliberately not surfaced as speed. They are
      most often reconnect/corruption edges, and showing their implied velocity
      would produce a dramatic but false wheel-speed sensor spike in the UI.
    */
    state.wheelSpeedsMmPerSecond = {
      left: null,
      right: null,
      center: null,
    };
    state.lastDelta = {
      leftCounts,
      rightCounts,
      leftMm: Math.round(leftMm),
      rightMm: Math.round(rightMm),
      centerMm: Math.round(centerMm),
      distanceMm: 0,
      elapsedMs,
      leftSpeedMmPerSecond: null,
      rightSpeedMmPerSecond: null,
      centerSpeedMmPerSecond: null,
      ignored: true,
    };
    state.updatedAt = sampleAt;
    const snapshot = snapshotState(state);
    emitSnapshot(state, snapshot);
    return snapshot;
  }

  state.totalMm += distanceMm;
  state.sessionMm += distanceMm;
  state.lastIntegratedAt = sampleAt;
  state.status = 'tracking';
  state.statusReason = distanceMm > 0 ? 'integrated encoder delta' : 'no movement';
  state.wheelSpeedsMmPerSecond = wheelSpeedsMmPerSecond;
  state.lastDelta = {
    leftCounts,
    rightCounts,
    leftMm: Math.round(leftMm),
    rightMm: Math.round(rightMm),
    centerMm: Math.round(centerMm),
    distanceMm: Math.round(distanceMm),
    elapsedMs,
    leftSpeedMmPerSecond: wheelSpeedsMmPerSecond.left,
    rightSpeedMmPerSecond: wheelSpeedsMmPerSecond.right,
    centerSpeedMmPerSecond: wheelSpeedsMmPerSecond.center,
    ignored: false,
  };
  state.updatedAt = sampleAt;
  persistSoon();
  const snapshot = snapshotState(state);
  emitSnapshot(state, snapshot);
  return snapshot;
}

function resetSession(roverId) {
  const state = ensureState(roverId);
  if (!state) return null;
  state.sessionMm = 0;
  state.updatedAt = nowMs();
  const snapshot = snapshotState(state);
  emitSnapshot(state, snapshot, { force: true });
  return snapshot;
}

process.on('exit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveNow();
});

module.exports = {
  ENCODER_MODULUS,
  DEFAULT_MM_PER_COUNT,
  odometerEvents,
  getSnapshot,
  getSnapshots,
  processSensorFrame,
  resetSession,
  saveNow,
};
