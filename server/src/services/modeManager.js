const EventEmitter = require('events');
const io = require('../globals/io');
const { sendAlert, COLORS } = require('./alertService');
const { isAdmin, isLockdownAdmin } = require('./roleService');

const MODES = {
  OPEN: 'open',
  TURNS: 'turns',
  ADMIN: 'admin',
  LOCKDOWN: 'lockdown',
};

let currentMode = MODES.ADMIN;
const modeEvents = new EventEmitter();

function canChangeMode(socket, nextMode) {
  if (nextMode === MODES.LOCKDOWN) {
    return isLockdownAdmin(socket);
  }
  return isAdmin(socket);
}

function setMode(nextMode, socket) {
  if (!Object.values(MODES).includes(nextMode)) {
    throw new Error(`Unknown mode ${nextMode}`);
  }
  if (!canChangeMode(socket, nextMode)) {
    throw new Error('Not authorized to change mode');
  }
  if (currentMode === nextMode) {
    return currentMode;
  }
  currentMode = nextMode;
  sendAlert({
    color: COLORS.info,
    title: 'Mode Changed',
    message: `Server mode set to ${nextMode}`,
  });
  modeEvents.emit('change', currentMode);
  io.emit('mode', { mode: currentMode });
  return currentMode;
}

function getMode() {
  return currentMode;
}

module.exports = {
  MODES,
  getMode,
  setMode,
  modeEvents,
};

io.on('connection', (socket) => {
  socket.emit('mode', { mode: currentMode });
  socket.on('setMode', ({ mode }) => {
    try {
      setMode(mode, socket);
    } catch (err) {
      sendAlert({ color: COLORS.error, title: 'Mode change failed', message: err.message });
    }
  });
});
