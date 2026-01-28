const roverWSS = require('../globals/ws');
const logger = require('../globals/logger').child('roverConnection');
const roverManager = require('./roverManager');
const { sendAlert } = require('./alertService');
const ALERT_COLOR = '#00bcd4';
const { handleAck } = require('./commandService');

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

function handleMessage(roverId, msg) {
  switch (msg.type) {
    case 'hello':
      roverManager.upsertRover(msg, this);
      sendAlert({ color: ALERT_COLOR, title: 'Rover Connected', message: roverId });
      break;
    case 'sensor':
      roverManager.handleSensorFrame(roverId, msg);
      break;
    case 'event': {
      const nightVisionOn = coerceBool(msg.data?.nightVisionOn);
      if (msg.event === 'nightVision.state' && nightVisionOn != null) {
        roverManager.setNightVisionState(roverId, nightVisionOn);
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
    } else if (msg.type === 'ack') {
      handleAck(msg);
    } else if (msg.type === 'event') {
      const nightVisionOn = coerceBool(msg.data?.nightVisionOn);
      if (msg.event === 'nightVision.state' && nightVisionOn != null) {
        roverManager.setNightVisionState(roverId, nightVisionOn);
      } else {
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
