const io = require('../globals/io');
const { MODES, getMode, modeEvents } = require('./modeManager');
const { isLockdownAdmin } = require('./roleService');

function disconnectForLockdown(socket) {
  socket.emit('lockdown', { message: 'Server is in lockdown mode' });
  socket.disconnect(true);
}

function clearLockdownTimer(socket) {
  if (socket?.data?.lockdownTimer) {
    clearTimeout(socket.data.lockdownTimer);
    socket.data.lockdownTimer = null;
  }
}

function enforceLockdown() {
  for (const socket of io.sockets.sockets.values()) {
    if (!isLockdownAdmin(socket)) {
      disconnectForLockdown(socket);
    }
  }
}

io.on('connection', (socket) => {
  if (getMode() === MODES.LOCKDOWN && !isLockdownAdmin(socket)) {
    socket.data.lockdownTimer = setTimeout(() => {
      if (!isLockdownAdmin(socket)) {
        disconnectForLockdown(socket);
      }
    }, 10000);
    socket.once('disconnect', () => clearLockdownTimer(socket));
  }
});

module.exports = {
  enforceLockdown,
  disconnectForLockdown,
  clearLockdownTimer,
};

modeEvents.on('change', (mode) => {
  if (mode === MODES.LOCKDOWN) {
    enforceLockdown();
  }
});
