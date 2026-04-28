// admin Log Service
// Purpose: Defines the admin Log Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const { v4: uuidv4 } = require('uuid');
const io = require('../../globals/io');
const { getRole, roleEvents } = require('../roleService');
const { getSocketIp } = require('../../helpers/ipResolver');

const ADMIN_ROLES = new Set(['admin', 'lockdown', 'lockdown-admin']);
const MAX_HISTORY = 200;
const history = [];

function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

function isAdminSocket(socket) {
  return isAdminRole(getRole(socket));
}

function pushEntry(entry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function emitToAdmins(event, payload) {
  io.sockets.sockets.forEach((socket) => {
    if (!isAdminSocket(socket)) return;
    socket.emit(event, payload);
  });
}

function logAdminEvent({ label, message, ip, meta = null, socketId = null }) {
  const entry = {
    id: uuidv4(),
    ts: Date.now(),
    label: label || null,
    message: message || '',
    ip: ip || null,
    meta: meta || null,
    socketId: socketId || null,
  };
  pushEntry(entry);
  emitToAdmins('adminlog:entry', entry);
}

function hydrateSocket(socket) {
  if (!socket || !isAdminSocket(socket)) return;
  socket.emit('adminlog:init', history);
}

io.on('connection', (socket) => {
  hydrateSocket(socket);
  const ip = getSocketIp(socket);
  if (ip) {
    logAdminEvent({
      label: 'socket',
      message: 'Socket connected',
      ip,
      meta: { role: getRole(socket) },
      socketId: socket.id,
    });
  }
  socket.on('disconnect', () => {
    const disconnectIp = getSocketIp(socket);
    if (!disconnectIp) return;
    logAdminEvent({
      label: 'socket',
      message: 'Socket disconnected',
      ip: disconnectIp,
      meta: { role: getRole(socket) },
      socketId: socket.id,
    });
  });
});

roleEvents.on('change', ({ socket, role }) => {
  if (!socket) return;
  if (!isAdminRole(role)) return;
  hydrateSocket(socket);
});

module.exports = {
  logAdminEvent,
};
