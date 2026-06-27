// rover Connection Service
// Purpose: Defines the rover Connection Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const roverWSS = require('../../globals/ws');
const logger = require('../../globals/logger').child('roverConnection');
const roverManager = require('../roverManager');
const { sendAlert } = require('../alertService');
const ALERT_COLOR = '#00bcd4';
const { handleAck } = require('../commandService');

function coerceBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    if (normalized === '1') return true;
    if (normalized === '0') return false;
  }
  return null;
}

const HEARTBEAT_INTERVAL_MS = 15000;

function handleToggleEvent(roverId, msg) {
  if (msg.event === 'headlight.state') {
    const headlightOn = coerceBool(msg.data?.headlightOn);
    if (headlightOn != null) {
      roverManager.setToggleState(roverId, 'headlight', headlightOn);
      return true;
    }
  }
  if (msg.event === 'laser.state') {
    const laserOn = coerceBool(msg.data?.laserOn);
    if (laserOn != null) {
      roverManager.setToggleState(roverId, 'laser', laserOn);
      return true;
    }
  }
  return false;
}

function handleMessage(roverId, msg) {
  switch (msg.type) {
    case 'hello':
      roverManager.upsertRover(msg, this);
      sendAlert({ color: ALERT_COLOR, title: 'Rover Connected', message: roverId });
      break;
    case 'sensor':
      roverManager.handleSensorFrame(roverId, msg);
      break;
    case 'hostStats':
      // Host stats are periodic Pi metadata, not user-facing rover events, so
      // they are routed directly to roverManager instead of becoming alerts.
      roverManager.handleHostStats(roverId, msg);
      break;
    case 'event': {
      if (handleToggleEvent(roverId, msg)) {
        break;
      }
      sendAlert({ color: ALERT_COLOR, title: `${roverId} event`, message: msg.event });
      break;
    }
    default:
      break;
  }
}

roverWSS.on('connection', (ws) => {
  let roverId = null;
  ws.isAlive = true;

  const heartbeat = setInterval(() => {
    if (!ws.isAlive) {
      logger.warn('Rover websocket unresponsive', roverId || 'unknown');
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  }, HEARTBEAT_INTERVAL_MS);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    ws.isAlive = true;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      logger.warn('Invalid rover message', err.message);
      return;
    }
    if (msg.type === 'hello') {
      roverId = msg.name;
      logger.info('Received rover hello', {
        roverId,
        keys: Object.keys(msg),
        cameraServo: msg.cameraServo,
      });
      roverManager.upsertRover(msg, ws);
      roverManager.broadcastRoster();
      sendAlert({ color: ALERT_COLOR, title: 'Rover Online', message: roverId });
      return;
    }
    if (!roverId) return;
    if (msg.type === 'sensor') {
      roverManager.handleSensorFrame(roverId, msg);
    } else if (msg.type === 'hostStats') {
      // Keep the Pi health stream separate from both Roomba sensorFrame data
      // and generic rover events, which are surfaced as alerts.
      roverManager.handleHostStats(roverId, msg);
    } else if (msg.type === 'ack') {
      handleAck(msg);
    } else if (msg.type === 'event') {
      if (!handleToggleEvent(roverId, msg)) {
        sendAlert({ color: ALERT_COLOR, title: `${roverId}`, message: msg.event });
      }
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    if (roverId) {
      roverManager.removeRover(roverId);
      sendAlert({ color: ALERT_COLOR, title: 'Rover Offline', message: roverId });
    }
  });
});
