// lockdown Guard
// Purpose: Defines the lockdown Guard module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const io = require('../../globals/io');
const { MODES, modeEvents } = require('../modeManager');
const { isLockdownAdmin } = require('../roleService');

function disconnectForLockdown(socket) {
  socket.disconnect(true);
}

function enforceLockdown() {
  for (const socket of io.sockets.sockets.values()) {
    if (!isLockdownAdmin(socket)) {
      disconnectForLockdown(socket);
    }
  }
}

module.exports = {};

modeEvents.on('change', (mode) => {
  if (mode === MODES.LOCKDOWN) {
    enforceLockdown();
  }
});
