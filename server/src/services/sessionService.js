const io = require('../globals/io');
const logger = require('../globals/logger').child('sessionService');
const { getRole, roleEvents } = require('./roleService');
const { getMode, modeEvents } = require('./modeManager');
const roverManager = require('./roverManager');
const { managerEvents } = roverManager;
const assignmentService = require('./assignmentService');
const { getActiveDrivers, turnEvents } = require('./turnService');

function buildSession(socket) {
  return {
    socketId: socket?.id || null,
    role: getRole(socket),
    mode: getMode(),
    roster: roverManager.getRoster(),
    assignment: assignmentService.describeAssignment(socket?.id || ''),
    activeDrivers: getActiveDrivers(),
  };
}

function syncSocket(socket) {
  if (!socket) return;
  const payload = buildSession(socket);
  logger.info('Syncing session', socket.id, payload.role, payload.assignment);
  socket.emit('session:sync', payload);
}

function syncAll() {
  logger.info('Broadcasting session sync to all sockets');
  io.sockets.sockets.forEach((socket) => syncSocket(socket));
}

io.on('connection', (socket) => {
  logger.info('New socket connected', socket.id);
  syncSocket(socket);
});

roleEvents.on('change', ({ socket }) => {
  if (!socket) return;
  logger.info('Role changed; syncing session', socket.id);
  syncSocket(socket);
});

assignmentService.assignmentEvents.on('update', (socketId) => {
  const socket = io.sockets.sockets.get(socketId);
  if (socket) {
    logger.info('Assignment update; syncing session', socketId);
    syncSocket(socket);
  }
});

modeEvents.on('change', () => {
  logger.info('Mode change detected; syncing all clients');
  syncAll();
});

managerEvents.on('rover', () => {
  logger.info('Rover roster change; syncing all clients');
  syncAll();
});

managerEvents.on('lock', ({ roverId, locked }) => {
  logger.info('Rover lock change', roverId, locked);
  syncAll();
});

turnEvents.on('activeDriver', () => {
  logger.info('Active driver change; syncing all clients');
  syncAll();
});

module.exports = {
  buildSession,
  syncSocket,
  syncAll,
};
