const EventEmitter = require('events');

const roleEvents = new EventEmitter();

function getRole(socket) {
  return socket?.data?.role || 'user';
}

function setRole(socket, role) {
  socket.data = socket.data || {};
  if (socket.data.role === role) {
    return;
  }
  socket.data.role = role;
  roleEvents.emit('change', { socket, role });
}

function isAdmin(socket) {
  const role = getRole(socket);
  return role === 'admin' || role === 'lockdown';
}

function isLockdownAdmin(socket) {
  return getRole(socket) === 'lockdown';
}

module.exports = {
  getRole,
  setRole,
  isAdmin,
  isLockdownAdmin,
  roleEvents,
};
