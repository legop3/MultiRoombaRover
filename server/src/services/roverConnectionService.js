const roverWSS = require('../globals/ws');
const logger = require('../globals/logger');
const roverManager = require('./roverManager');
const { sendAlert, COLORS } = require('./alertService');
const { handleAck } = require('./commandService');

function handleMessage(roverId, msg) {
  switch (msg.type) {
    case 'hello':
      roverManager.upsertRover(msg, this);
      sendAlert({ color: COLORS.info, title: 'Rover Connected', message: roverId });
      break;
    case 'sensor':
      roverManager.handleSensorFrame(roverId, msg);
      break;
    case 'event':
      sendAlert({ color: COLORS.info, title: `${roverId} event`, message: msg.event });
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
      roverManager.upsertRover(msg, ws);
      roverManager.broadcastRoster();
      sendAlert({ color: COLORS.success, title: 'Rover Online', message: roverId });
      return;
    }
    if (!roverId) return;
    if (msg.type === 'sensor') {
      roverManager.handleSensorFrame(roverId, msg);
    } else if (msg.type === 'ack') {
      handleAck(msg);
    } else if (msg.type === 'event') {
      sendAlert({ color: COLORS.info, title: `${roverId}`, message: msg.event });
    }
  });

  ws.on('close', () => {
    if (roverId) {
      roverManager.removeRover(roverId);
      sendAlert({ color: COLORS.warn, title: 'Rover Offline', message: roverId });
    }
  });
});
