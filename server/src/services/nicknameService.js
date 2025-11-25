const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('nicknameService');
const { getRole } = require('./roleService');

const nicknameEvents = new EventEmitter();

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 32);
}

function getNickname(socket) {
  return socket?.data?.nickname || '';
}

function setNickname(socket, nickname) {
  if (!socket) return null;
  const role = getRole(socket);
  // if (role === 'spectator') {
  //   throw new Error('Spectators cannot set nicknames');
  // }
  const value = sanitizeNickname(nickname);
  if (!value) {
    throw new Error('Nickname required');
  }
  socket.data = socket.data || {};
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
