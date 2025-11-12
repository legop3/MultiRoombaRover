const { v4: uuidv4 } = require('uuid');
const io = require('../globals/io');
const roverManager = require('./roverManager');
const { isAdmin } = require('./authService');

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
  return id;
}

function handleAck(msg) {
  const pending = pendingCommands.get(msg.id);
  if (!pending) return;
  pendingCommands.delete(msg.id);
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
  socket.on('command', ({ roverId, type, data } = {}, cb = () => {}) => {
    try {
      if (!roverId) {
        throw new Error('roverId required');
      }
      if (!roverManager.isDriver(roverId, socket) && !isAdmin(socket)) {
        throw new Error('Not controlling this rover');
      }
      const payload = data ? { ...data } : {};
      const id = issueCommand(roverId, { type, ...payload });
      cb({ id });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});
