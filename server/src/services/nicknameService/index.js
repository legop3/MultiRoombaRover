// nickname Service
// Purpose: Defines the nickname Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('nicknameService');

const nicknameEvents = new EventEmitter();

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const sanitized = trimmed.replace(/\*/g, 'nope');
  return sanitized.slice(0, 32);
}

function getNickname(socket) {
  return socket?.data?.nickname || '';
}

function setNickname(socket, nickname) {
  if (!socket) return null;
  const value = sanitizeNickname(nickname);
  if (!value) {
    throw new Error('Nickname required');
  }
  socket.data = socket.data || {};
  if (socket.data.nickname === value) {
    return value;
  }
  socket.data.nickname = value;
  nicknameEvents.emit('change', { socketId: socket.id, nickname: value });
  logger.info('Nickname set', { socketId: socket.id, nickname: value });
  return value;
}

io.on('connection', (socket) => {
  socket.on('nickname:set', ({ nickname } = {}, cb = () => {}) => {
    try {
      const value = setNickname(socket, nickname);
      cb({ success: true, nickname: value });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

module.exports = {
  getNickname,
  setNickname,
  nicknameEvents,
};
