// role Service
// Purpose: Defines the role Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
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
