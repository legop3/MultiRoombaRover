// Balance Board Service
// Purpose: Exposes one Wii Balance Board as a self-pairing Bluetooth scale.
// Scope: Stores the paired address, applies a small automatic tare, and publishes simple status plus live weight.
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
const TARE_SAMPLE_COUNT = 20;
const MAX_AUTOMATIC_TARE_KG = 2;
const execFileAsync = promisify(execFile);
const ALERT_COLOR = '#38bdf8';

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const address = typeof parsed?.address === 'string' ? parsed.address.trim().toUpperCase() : '';
    return { address };
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('Failed to load Balance Board address', err.message);
    return { address: '' };
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

function rawWeightKg(corners = {}) {
  // The native wiiuse bridge reports each calibrated load cell in
  // centi-kilograms. The UI only needs total scale weight, so sum and convert
  // at this single boundary.
  return ['topRight', 'bottomRight', 'topLeft', 'bottomLeft']
    .reduce((total, key) => total + Math.max(0, Number(corners[key]) || 0), 0) / 100;
}

function cornerWeightsKg(corners = {}) {
  // Preserve all four factory-calibrated load cells in kilograms. Their
  // relative distribution drives the center-of-pressure dot in the panel,
  // while the existing tare continues to apply only to the displayed total.
  return {
    topRight: roundedWeight((Number(corners.topRight) || 0) / 100),
    bottomRight: roundedWeight((Number(corners.bottomRight) || 0) / 100),
    topLeft: roundedWeight((Number(corners.topLeft) || 0) / 100),
    bottomLeft: roundedWeight((Number(corners.bottomLeft) || 0) / 100),
  };
}

let store = enabled ? loadStore() : { address: '' };
let hardware = null;
let status = enabled ? (store.address ? 'waiting' : 'starting') : 'disabled';
let detail = enabled
  ? (store.address ? 'Press the front power button.' : 'Starting Bluetooth discovery.')
  : 'Balance Board support is disabled.';
let connected = false;
let batteryPercent = null;
let latestFrame = null;
let tareSamples = [];
let tareKg = 0;
let previousWorkerState = '';
let lastAlertKey = '';
let unpairing = false;

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
  const rawMessage = message ? `${workerState}: ${message}` : workerState;
  const key = rawMessage;
  if (key === lastAlertKey) return;
  lastAlertKey = key;
  sendAlert({ color: ALERT_COLOR, title: 'Balance Board', message: rawMessage });
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
  };
}

function updateStatus(nextStatus, nextDetail) {
  const normalizedStatus = String(nextStatus || 'unknown');
  const normalizedDetail = String(nextDetail || '');
  if (status === normalizedStatus && detail === normalizedDetail) return;
  status = normalizedStatus;
  detail = normalizedDetail;
  events.emit('change', { state: getState() });
}

function processFrame(message = {}) {
  const rawKg = rawWeightKg(message.corners);
  if (Number.isFinite(Number(message.batteryPercent))) {
    batteryPercent = Math.max(0, Math.min(100, Number(message.batteryPercent)));
  }

  if (tareSamples.length < TARE_SAMPLE_COUNT && rawKg <= MAX_AUTOMATIC_TARE_KG) {
    tareSamples.push(rawKg);
    if (tareSamples.length === TARE_SAMPLE_COUNT) {
      tareKg = tareSamples.reduce((sum, value) => sum + value, 0) / tareSamples.length;
    }
  }

  connected = true;
  const zeroReady = tareSamples.length >= TARE_SAMPLE_COUNT;
  updateStatus(
    zeroReady ? 'connected' : 'zeroing',
    zeroReady ? 'Live weight is updating.' : 'Keep the board empty for one second while it zeros.',
  );
  latestFrame = {
    totalKg: roundedWeight(rawKg - tareKg),
    corners: cornerWeightsKg(message.corners),
    batteryPercent,
  };
  io.to(FRAME_ROOM).emit('balanceBoard:frame', latestFrame);
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
    lastAlertKey = 'paired';
    sendAlert({
      color: ALERT_COLOR,
      title: 'Balance Board',
      message: 'paired',
    });
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
  } else if (workerState === 'pairing') {
    updateStatus('pairing', 'Board found. Pairing now.');
  } else if (workerState === 'connected') {
    connected = true;
    tareSamples = [];
    tareKg = 0;
    updateStatus('zeroing', 'Connected. Keep the board empty for one second while it zeros.');
  } else if (workerState === 'link-detected') {
    connected = false;
    // The native bridge can now distinguish which half of the board's HID
    // connection reached the server. Preserve that diagnostic until both
    // channels arrive; the generic text remains for the outbound Sync flow.
    updateStatus('connecting', message.error || 'Board responded. Reading its sensor calibration.');
  } else if (workerState === 'connection-failed') {
    connected = false;
    latestFrame = null;
    updateStatus('connection-failed', message.error || 'The direct Balance Board connection failed.');
  } else if (workerState === 'sleeping') {
    connected = false;
    latestFrame = null;
    updateStatus('sleeping', message.error || 'Board is asleep. Press the front power button to wake it.');
  } else if (workerState === 'waiting') {
    connected = false;
    latestFrame = null;
    updateStatus('waiting', message.error || 'Press the front power button. The server will keep trying to connect.');
  } else if (workerState === 'error') {
    connected = false;
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
      persistStore();
      connected = false;
      batteryPercent = null;
      latestFrame = null;
      tareSamples = [];
      tareKg = 0;
      previousWorkerState = '';
      lastAlertKey = 'unpaired';
      hardware?.setAddress('');
      hardware?.restart();
      updateStatus('starting', 'Starting Bluetooth discovery.');
      sendAlert({
        color: ALERT_COLOR,
        title: 'Balance Board',
        message: 'unpaired',
      });
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
