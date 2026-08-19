// Balance Board Service
// Purpose: Exposes one Wii Balance Board as a self-pairing Bluetooth scale.
// Scope: Stores pairing and admin zero calibration, then publishes status plus live four-corner weight.
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('balanceBoardService');
const { loadConfig } = require('../../helpers/configLoader');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const { isFeatureEnabled } = require('../../helpers/features');
const { isAdmin } = require('../roleService');
const { sendAlert } = require('../alertService');
const { createBalanceBoardHardware } = require('./hardware');

const events = new EventEmitter();
const enabled = isFeatureEnabled('balanceBoard');
const rawConfig = loadConfig().balanceBoard || {};
const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('balance-board.json');
const FRAME_ROOM = 'balance-board-viewers';
const CORNER_KEYS = ['topRight', 'bottomRight', 'topLeft', 'bottomLeft'];
const ZERO_SAMPLE_COUNT = 10;
const ZERO_SAMPLE_INTERVAL_MS = 1000;
const ZERO_MAX_SAMPLE_AGE_MS = 1500;
const ZERO_MAX_COMBINED_RANGE_KG = 0.5;
const RECORD_PERSIST_DELAY_MS = 1000;
const execFileAsync = promisify(execFile);
const ALERT_COLOR = '#38bdf8';

function emptyZeroCorners() {
  return Object.fromEntries(CORNER_KEYS.map((key) => [key, 0]));
}

function normalizeStoredCorners(value) {
  if (!value || typeof value !== 'object') return emptyZeroCorners();
  return Object.fromEntries(CORNER_KEYS.map((key) => {
    const number = Number(value[key]);
    return [key, Number.isFinite(number) ? Math.max(0, number) : 0];
  }));
}

function emptyStore() {
  return {
    address: '',
    zeroCorners: emptyZeroCorners(),
    zeroedAt: null,
    recordKg: 0,
    recordedAt: null,
  };
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const address = typeof parsed?.address === 'string' ? parsed.address.trim().toUpperCase() : '';
    const zeroedAt = Number.isFinite(Number(parsed?.zeroedAt)) ? Number(parsed.zeroedAt) : null;
    const recordKg = Number.isFinite(Number(parsed?.recordKg))
      ? roundedWeight(parsed.recordKg)
      : 0;
    const recordedAt = Number.isFinite(Number(parsed?.recordedAt))
      ? Number(parsed.recordedAt)
      : null;
    return {
      address,
      zeroCorners: zeroedAt ? normalizeStoredCorners(parsed.zeroCorners) : emptyZeroCorners(),
      zeroedAt,
      recordKg,
      recordedAt: recordKg > 0 ? recordedAt : null,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('Failed to load Balance Board address', err.message);
    return emptyStore();
  }
}

function persistStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, STORE_PATH);
}

function roundedWeight(value) {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
}

function cornerWeightsKg(corners = {}) {
  // Preserve wiiuse's factory-calibrated load cells in kilograms. The separate
  // admin zero calibration below is an installation baseline layered on top of
  // this factory conversion; it must never replace the hardware calibration.
  return {
    topRight: roundedWeight((Number(corners.topRight) || 0) / 100),
    bottomRight: roundedWeight((Number(corners.bottomRight) || 0) / 100),
    topLeft: roundedWeight((Number(corners.topLeft) || 0) / 100),
    bottomLeft: roundedWeight((Number(corners.bottomLeft) || 0) / 100),
  };
}

function subtractZero(rawCorners) {
  const baseline = store.zeroedAt ? store.zeroCorners : emptyZeroCorners();
  return Object.fromEntries(CORNER_KEYS.map((key) => [
    key,
    roundedWeight(Math.max(0, rawCorners[key] - baseline[key])),
  ]));
}

function totalCornerWeight(corners) {
  return roundedWeight(CORNER_KEYS.reduce((total, key) => total + corners[key], 0));
}

let store = enabled ? loadStore() : emptyStore();
let hardware = null;
let status = enabled ? (store.address ? 'waiting' : 'starting') : 'disabled';
let detail = enabled
  ? (store.address ? 'Press the front power button.' : 'Starting Bluetooth discovery.')
  : 'Balance Board support is disabled.';
let connected = false;
let batteryPercent = null;
let latestFrame = null;
let latestRawCorners = null;
let latestRawFrameAt = 0;
let zeroTimer = null;
let recordPersistTimer = null;
let zeroSamples = [];
let zeroProgress = {
  active: false,
  samplesCollected: 0,
  totalSamples: ZERO_SAMPLE_COUNT,
  error: '',
};
let previousWorkerState = '';
let lastAlertKey = '';
let unpairing = false;

function sendRawAlert(state, message = '') {
  const rawMessage = message ? `${state}: ${message}` : state;
  if (rawMessage === lastAlertKey) return;
  lastAlertKey = rawMessage;
  sendAlert({ color: ALERT_COLOR, title: 'Balance Board', message: rawMessage });
}

function sendStatusAlert(workerState, message = '') {
  const shouldAlert =
    workerState === 'connected' ||
    workerState === 'sleeping' ||
    workerState === 'connection-failed' ||
    workerState === 'error' ||
    (workerState === 'waiting' && previousWorkerState === 'connected');

  previousWorkerState = workerState;
  if (!shouldAlert) return;

  // Keep the alert at the same system-level boundary as the worker protocol:
  // state first, followed by its exact detail when one exists. The service does
  // not reinterpret failures as friendlier product copy, but still collapses
  // identical retries so a failing reconnect cannot flood the activity feed.
  sendRawAlert(workerState, message);
}

function getState() {
  return {
    enabled,
    paired: Boolean(store.address) || Boolean(rawConfig.simulate),
    address: store.address || (rawConfig.simulate ? 'SIMULATED' : null),
    connected,
    status,
    detail,
    batteryPercent,
    recordKg: store.recordKg,
    recordedAt: store.recordedAt,
    calibration: {
      calibrated: Boolean(store.zeroedAt),
      zeroedAt: store.zeroedAt,
      ...zeroProgress,
    },
  };
}

function clearRecordPersistTimer() {
  if (!recordPersistTimer) return;
  clearTimeout(recordPersistTimer);
  recordPersistTimer = null;
}

function scheduleRecordPersistence() {
  clearRecordPersistTimer();

  // A person driving onto the board produces many successively larger frames.
  // Waiting until the maximum has stopped changing prevents a synchronous JSON
  // rewrite for every 20 Hz sensor frame while still saving a settled record
  // promptly enough to survive an ordinary service restart.
  recordPersistTimer = setTimeout(() => {
    recordPersistTimer = null;
    persistStore();
  }, RECORD_PERSIST_DELAY_MS);
  recordPersistTimer.unref?.();
}

function publishLatestFrame() {
  if (!latestFrame) return;
  io.to(FRAME_ROOM).emit('balanceBoard:frame', latestFrame);
}

function resetWeightRecord() {
  clearRecordPersistTimer();

  // Reset means "start measuring the record from now." If the board currently
  // has a load, that current measurement is the first candidate in the new
  // period. Saving it immediately avoids briefly showing zero before the next
  // live frame restores the same weight as the record.
  const currentWeight = connected && latestFrame ? roundedWeight(latestFrame.totalKg) : 0;
  store.recordKg = currentWeight;
  store.recordedAt = currentWeight > 0 ? Date.now() : null;
  persistStore();

  if (latestFrame) {
    latestFrame = {
      ...latestFrame,
      recordKg: store.recordKg,
      recordedAt: store.recordedAt,
    };
    publishLatestFrame();
  }
  events.emit('change', { state: getState() });
  sendRawAlert('record-reset');
}

function updateStatus(nextStatus, nextDetail) {
  const normalizedStatus = String(nextStatus || 'unknown');
  const normalizedDetail = String(nextDetail || '');
  if (status === normalizedStatus && detail === normalizedDetail) return;
  status = normalizedStatus;
  detail = normalizedDetail;
  events.emit('change', { state: getState() });
}

function publishCalibrationState() {
  // Calibration progress belongs in the ordinary session payload because it
  // changes only once per second for ten seconds. Live 20 Hz weights remain in
  // their dedicated room and never trigger a full-session broadcast.
  events.emit('change', { state: getState() });
}

function clearZeroTimer() {
  if (!zeroTimer) return;
  clearInterval(zeroTimer);
  zeroTimer = null;
}

function failZeroCalibration(error, { alert = true } = {}) {
  clearZeroTimer();
  zeroSamples = [];
  zeroProgress = {
    active: false,
    samplesCollected: 0,
    totalSamples: ZERO_SAMPLE_COUNT,
    error: String(error || 'Calibration failed'),
  };
  publishCalibrationState();
  if (alert) sendRawAlert('zero-failed', zeroProgress.error);
}

function finishZeroCalibration() {
  clearZeroTimer();

  // A single average could hide movement that returns to its starting point.
  // Sum every corner's complete ten-second range before accepting the result so
  // distributed movement cannot hide below four independent thresholds. Retain
  // three decimals so averaging ten centi-kilogram samples does not throw away
  // useful sub-centi-kilogram precision in the persisted baseline.
  const combinedRange = CORNER_KEYS.reduce((totalRange, key) => {
    const values = zeroSamples.map((sample) => sample[key]);
    return totalRange + Math.max(...values) - Math.min(...values);
  }, 0);
  if (combinedRange > ZERO_MAX_COMBINED_RANGE_KG) {
    failZeroCalibration('Load moved during the ten-second calibration.');
    return;
  }

  store.zeroCorners = Object.fromEntries(CORNER_KEYS.map((key) => {
    const average = zeroSamples.reduce((sum, sample) => sum + sample[key], 0) /
      zeroSamples.length;
    return [key, Math.round(average * 1000) / 1000];
  }));
  store.zeroedAt = Date.now();
  // A new zero changes the meaning of every adjusted weight, so an old record
  // cannot be compared with measurements under the new baseline.
  clearRecordPersistTimer();
  store.recordKg = 0;
  store.recordedAt = null;
  persistStore();
  zeroSamples = [];
  zeroProgress = {
    active: false,
    samplesCollected: ZERO_SAMPLE_COUNT,
    totalSamples: ZERO_SAMPLE_COUNT,
    error: '',
  };
  publishCalibrationState();
  sendRawAlert('zeroed');
}

function takeZeroSample() {
  if (!connected || !latestRawCorners || Date.now() - latestRawFrameAt > ZERO_MAX_SAMPLE_AGE_MS) {
    failZeroCalibration('Live Balance Board data stopped during calibration.');
    return;
  }

  zeroSamples.push({ ...latestRawCorners });
  zeroProgress = {
    active: true,
    samplesCollected: zeroSamples.length,
    totalSamples: ZERO_SAMPLE_COUNT,
    error: '',
  };
  publishCalibrationState();
  if (zeroSamples.length >= ZERO_SAMPLE_COUNT) finishZeroCalibration();
}

function startZeroCalibration() {
  if (zeroProgress.active) throw new Error('Balance Board zero calibration is already running');
  if (!connected || !latestRawCorners || Date.now() - latestRawFrameAt > ZERO_MAX_SAMPLE_AGE_MS) {
    throw new Error('The Balance Board must be connected and sending weight data');
  }

  zeroSamples = [];
  zeroProgress = {
    active: true,
    samplesCollected: 0,
    totalSamples: ZERO_SAMPLE_COUNT,
    error: '',
  };
  publishCalibrationState();
  sendRawAlert('zeroing');
  // Delaying the first sample by one interval makes this a real ten-second
  // calibration rather than ten rapid reads followed by nine seconds of UI.
  zeroTimer = setInterval(takeZeroSample, ZERO_SAMPLE_INTERVAL_MS);
}

function processFrame(message = {}) {
  const rawCorners = cornerWeightsKg(message.corners);
  latestRawCorners = rawCorners;
  latestRawFrameAt = Date.now();
  if (Number.isFinite(Number(message.batteryPercent))) {
    batteryPercent = Math.max(0, Math.min(100, Number(message.batteryPercent)));
  }

  connected = true;
  updateStatus('connected', 'Live weight is updating.');
  const adjustedCorners = subtractZero(rawCorners);
  const totalKg = totalCornerWeight(adjustedCorners);
  if (totalKg > store.recordKg) {
    // Store only adjusted weight so the displayed record uses the same admin
    // zero baseline as the live total and all four corner readings.
    store.recordKg = totalKg;
    store.recordedAt = Date.now();
    scheduleRecordPersistence();
  }
  latestFrame = {
    totalKg,
    corners: adjustedCorners,
    batteryPercent,
    recordKg: store.recordKg,
    recordedAt: store.recordedAt,
  };
  publishLatestFrame();
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
      // A zero baseline belongs to one physical board and whatever permanent
      // platform/load was present when an admin calibrated it. Never carry that
      // baseline across commissioning a different Bluetooth identity.
      store.zeroCorners = emptyZeroCorners();
      store.zeroedAt = null;
      clearRecordPersistTimer();
      store.recordKg = 0;
      store.recordedAt = null;
      persistStore();
    }
    hardware?.setAddress(address);
    sendRawAlert('paired');
    updateStatus('connecting', 'Paired. Connecting to the board now.');
    return;
  }

  if (message.type !== 'status') return;
  const workerState = String(message.state || 'unknown');
  sendStatusAlert(workerState, message.error || '');
  if (workerState === 'commissioning') {
    updateStatus('starting', 'Starting Bluetooth discovery.');
  } else if (workerState === 'discovering') {
    updateStatus('waiting-for-sync', 'Press the red Sync button underneath the board.');
  } else if (workerState === 'device-detected') {
    // Preserve the worker's exact identification stage instead of leaving the
    // panel apparently unchanged when an adapter sees only the board's address.
    // This is intentionally not a feed alert because ambient unresolved devices
    // can appear during commissioning and the state is already visible locally.
    updateStatus(
      'identifying',
      message.error || 'Bluetooth device detected; checking whether it is the Balance Board.',
    );
  } else if (workerState === 'pairing') {
    updateStatus('pairing', 'Board found. Pairing now.');
  } else if (workerState === 'connected') {
    connected = true;
    updateStatus('connected', 'Connected. Waiting for live weight data.');
  } else if (workerState === 'link-detected') {
    connected = false;
    // The native bridge can now distinguish which half of the board's HID
    // connection reached the server. Preserve that diagnostic until both
    // channels arrive; the generic text remains for the outbound Sync flow.
    updateStatus('connecting', message.error || 'Board responded. Reading its sensor calibration.');
  } else if (workerState === 'connection-failed') {
    connected = false;
    latestFrame = null;
    latestRawCorners = null;
    latestRawFrameAt = 0;
    if (zeroProgress.active) failZeroCalibration('Board disconnected during calibration.');
    updateStatus('connection-failed', message.error || 'The direct Balance Board connection failed.');
  } else if (workerState === 'sleeping') {
    connected = false;
    latestFrame = null;
    latestRawCorners = null;
    latestRawFrameAt = 0;
    if (zeroProgress.active) failZeroCalibration('Board slept during calibration.');
    updateStatus('sleeping', message.error || 'Board is asleep. Press the front power button to wake it.');
  } else if (workerState === 'waiting') {
    connected = false;
    latestFrame = null;
    latestRawCorners = null;
    latestRawFrameAt = 0;
    if (zeroProgress.active) failZeroCalibration('Board disconnected during calibration.');
    updateStatus('waiting', message.error || 'Press the front power button. The server will keep trying to connect.');
  } else if (workerState === 'error') {
    connected = false;
    latestRawCorners = null;
    latestRawFrameAt = 0;
    if (zeroProgress.active) failZeroCalibration('Worker stopped during calibration.');
    updateStatus('error', message.error || 'The Balance Board worker stopped.');
  }
}

io.on('connection', (socket) => {
  socket.on('balanceBoard:subscribe', (_payload = {}, cb = () => {}) => {
    socket.join(FRAME_ROOM);
    if (latestFrame) socket.emit('balanceBoard:frame', latestFrame);
    cb({ success: true });
  });
  socket.on('balanceBoard:unsubscribe', () => socket.leave(FRAME_ROOM));
  socket.on('balanceBoard:zero', (_payload = {}, cb = () => {}) => {
    if (!isAdmin(socket)) {
      cb({ error: 'Admin access required' });
      return;
    }
    try {
      startZeroCalibration();
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message || 'Failed to start Balance Board zero calibration' });
    }
  });
  socket.on('balanceBoard:resetRecord', (_payload = {}, cb = () => {}) => {
    if (!isAdmin(socket)) {
      cb({ error: 'Admin access required' });
      return;
    }

    try {
      resetWeightRecord();
      cb({ success: true });
    } catch (err) {
      logger.error('Failed to reset Balance Board weight record', err);
      cb({ error: err.message || 'Failed to reset the Balance Board weight record' });
    }
  });
  socket.on('balanceBoard:unpair', async (_payload = {}, cb = () => {}) => {
    if (!isAdmin(socket)) {
      cb({ error: 'Admin access required' });
      return;
    }
    if (unpairing) {
      cb({ error: 'The Balance Board is already being unpaired' });
      return;
    }

    unpairing = true;
    const address = store.address;
    let bluetoothWarning = '';
    try {
      if (address) {
        try {
          // A complete forget removes both sources of remembered identity. If
          // only the JSON address or only the BlueZ bond were removed, the next
          // red-Sync attempt could inherit half of the previous relationship.
          await execFileAsync('bluetoothctl', ['remove', address], { timeout: 10000 });
        } catch (err) {
          bluetoothWarning = String(
            err?.stderr || err?.message || 'BlueZ did not remove the bond',
          ).trim();
          logger.warn('Balance Board BlueZ bond removal failed', bluetoothWarning);
        }
      }

      store.address = '';
      store.zeroCorners = emptyZeroCorners();
      store.zeroedAt = null;
      clearRecordPersistTimer();
      store.recordKg = 0;
      store.recordedAt = null;
      persistStore();
      clearZeroTimer();
      zeroSamples = [];
      zeroProgress = {
        active: false,
        samplesCollected: 0,
        totalSamples: ZERO_SAMPLE_COUNT,
        error: '',
      };
      connected = false;
      batteryPercent = null;
      latestFrame = null;
      latestRawCorners = null;
      latestRawFrameAt = 0;
      previousWorkerState = '';
      hardware?.setAddress('');
      hardware?.restart();
      updateStatus('starting', 'Starting Bluetooth discovery.');
      sendRawAlert('unpaired');
      cb({ success: true, warning: bluetoothWarning || null });
    } catch (err) {
      logger.error('Failed to unpair Balance Board', err);
      cb({ error: err.message || 'Failed to unpair the Balance Board' });
    } finally {
      unpairing = false;
    }
  });
});

if (enabled) {
  hardware = createBalanceBoardHardware({
    logger,
    address: store.address,
    simulate: Boolean(rawConfig.simulate || process.env.BALANCE_BOARD_SIMULATE),
  });
  hardware.events.on('message', handleWorkerMessage);
  hardware.start();
} else {
  logger.info('Balance Board disabled by config');
}

function installShutdownHooks() {
  const shutdown = () => {
    clearZeroTimer();
    // A record may still be inside the short debounce window when the process
    // receives a normal shutdown signal. Flush that newest maximum before the
    // hardware worker stops so a clean restart cannot lose it.
    if (recordPersistTimer) {
      clearRecordPersistTimer();
      persistStore();
    }
    hardware?.stop();
  };
  process.once('exit', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

installShutdownHooks();

module.exports = {
  getState,
  balanceBoardEvents: events,
};
