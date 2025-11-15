const { v4: uuidv4 } = require('uuid');
const io = require('../globals/io');
const roverManager = require('./roverManager');
const logger = require('../globals/logger').child('commandService');

const pendingCommands = new Map(); // id -> { roverId }

function issueCommand(roverId, payload) {
  const record = roverManager.rovers.get(roverId);
  if (!record || !record.ws) {
    throw new Error('Rover offline');
  }
  const id = uuidv4();
  const message = { ...payload, id };
  record.ws.send(JSON.stringify(message));
  pendingCommands.set(id, { roverId, ts: Date.now(), type: payload.type });
  logger.info('Issued command', roverId, payload.type, id);
  return id;
}

function handleAck(msg) {
  const pending = pendingCommands.get(msg.id);
  if (!pending) return;
  pendingCommands.delete(msg.id);
  logger.info('Command acknowledged', pending.roverId, pending.type, msg.status);
  io.emit('commandAck', {
    roverId: pending.roverId,
    id: msg.id,
    status: msg.status || 'ok',
    error: msg.error,
  });
}

module.exports = {
  issueCommand,
  handleAck,
};

io.on('connection', (socket) => {
  function handleCommand({ roverId, type, data } = {}, cb = () => {}) {
    try {
      if (!roverId) {
        throw new Error('roverId required');
      }
      if (!roverManager.canDrive(roverId, socket)) {
        throw new Error('Not your turn or no control');
      }
      const payload = data ? { ...data } : {};
      const id = issueCommand(roverId, { type, ...payload });
      logger.info('Queued command', socket.id, roverId, type);
      cb({ id });
    } catch (err) {
      logger.warn('Command rejected', socket.id, err.message);
      cb({ error: err.message });
    }
  }

  socket.on('command', handleCommand);
  socket.on('command:issue', handleCommand);
});
