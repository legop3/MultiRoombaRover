const roverWSS = require('../globals/ws');
const logger = require('../globals/logger').child('roverConnection');
const roverManager = require('./roverManager');
const { sendAlert } = require('./alertService');
const ALERT_COLOR = '#00bcd4';
const { handleAck } = require('./commandService');

function handleMessage(roverId, msg) {
  switch (msg.type) {
    case 'hello':
      roverManager.upsertRover(msg, this);
      sendAlert({ color: ALERT_COLOR, title: 'Rover Connected', message: roverId });
      break;
    case 'sensor':
      roverManager.handleSensorFrame(roverId, msg);
      break;
    case 'event':
      sendAlert({ color: ALERT_COLOR, title: `${roverId} event`, message: msg.event });
      break;
    default:
      break;
  }
}

roverWSS.on('connection', (ws) => {
  let roverId = null;
  ws.on('message', (raw) => {
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
      sendAlert({ color: ALERT_COLOR, title: `${roverId}`, message: msg.event });
    }
  });

  ws.on('close', () => {
    if (roverId) {
      roverManager.removeRover(roverId);
      sendAlert({ color: ALERT_COLOR, title: 'Rover Offline', message: roverId });
    }
  });
});
