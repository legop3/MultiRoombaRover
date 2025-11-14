const { v4: uuidv4 } = require('uuid');
const io = require('../globals/io');

const sessions = new Map(); // sessionId -> { socketId, roverId }
const socketSessions = new Map(); // socketId -> Set(sessionId)

function createSession(socket, roverId) {
  const sessionId = uuidv4();
  sessions.set(sessionId, { socketId: socket.id, roverId });
  if (!socketSessions.has(socket.id)) {
    socketSessions.set(socket.id, new Set());
  }
  socketSessions.get(socket.id).add(sessionId);
  return sessionId;
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function revokeSession(sessionId) {
  const info = sessions.get(sessionId);
  if (!info) return;
  sessions.delete(sessionId);
  const bucket = socketSessions.get(info.socketId);
  if (bucket) {
    bucket.delete(sessionId);
    if (bucket.size === 0) {
      socketSessions.delete(info.socketId);
    }
  }
}

function revokeBySocket(socketId) {
  const bucket = socketSessions.get(socketId);
  if (!bucket) return;
  for (const sessionId of bucket) {
    sessions.delete(sessionId);
  }
  socketSessions.delete(socketId);
}

function revokeWhere(predicate) {
  for (const [sessionId, info] of Array.from(sessions.entries())) {
    if (predicate(info)) {
      revokeSession(sessionId);
    }
  }
}

io.on('connection', (socket) => {
  socket.on('disconnect', () => revokeBySocket(socket.id));
});

module.exports = {
  createSession,
  getSession,
  revokeSession,
  revokeBySocket,
  revokeWhere,
};
