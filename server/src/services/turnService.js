const EventEmitter = require('events');
const io = require('../globals/io');
const { sendAlert, COLORS } = require('./alertService');
const { MODES, getMode, modeEvents } = require('./modeManager');

const driverQueues = new Map(); // roverId -> { queue: [], current: socketId, timer: Timeout | null }
const activeDrivers = new Map();
const TURN_DURATION_MS = 60 * 1000;
const turnEvents = new EventEmitter();

function driverAdded(roverId, socketId, force) {
  const queue = ensureQueue(roverId);
  if (!queue.queue.includes(socketId)) {
    queue.queue.push(socketId);
  }
  if (!queue.current || force) {
    queue.current = socketId;
  }
  syncState(roverId);
}

function driverRemoved(roverId, socketId) {
  const queue = driverQueues.get(roverId);
  if (!queue) return;
  queue.queue = queue.queue.filter((id) => id !== socketId);
  if (queue.current === socketId) {
    advanceTurn(roverId);
  }
}

function cleanupRover(roverId) {
  const queue = driverQueues.get(roverId);
  if (queue) {
    clearTimeout(queue.timer);
  }
  driverQueues.delete(roverId);
  activeDrivers.delete(roverId);
}

function canDrive(roverId, socket) {
  if (!socket) return false;
  const queue = driverQueues.get(roverId);
  if (!queue || getMode() !== MODES.TURNS || queue.queue.length <= 1) {
    return true;
  }
  return activeDrivers.get(roverId) === socket.id;
}

function ensureQueue(roverId) {
  if (!driverQueues.has(roverId)) {
    driverQueues.set(roverId, { queue: [], current: null, timer: null });
  }
  return driverQueues.get(roverId);
}

function syncState(roverId) {
  const mode = getMode();
  const queue = ensureQueue(roverId);
  if (mode !== MODES.TURNS || queue.queue.length <= 1) {
    queue.current = queue.queue[0] || null;
    setActiveDriver(roverId, queue.current);
    clearTimeout(queue.timer);
    return;
  }
  if (!queue.current) {
    queue.current = queue.queue[0];
  }
  setActiveDriver(roverId, queue.current);
  scheduleNextTurn(roverId);
}

function scheduleNextTurn(roverId) {
  const queue = driverQueues.get(roverId);
  if (!queue) return;
  clearTimeout(queue.timer);
  queue.timer = setTimeout(() => advanceTurn(roverId), TURN_DURATION_MS);
}

function advanceTurn(roverId) {
  const queue = driverQueues.get(roverId);
  if (!queue) return;
  if (queue.queue.length === 0) {
    clearTimeout(queue.timer);
    setActiveDriver(roverId, null);
    return;
  }
  const mode = getMode();
  if (mode !== MODES.TURNS || queue.queue.length <= 1) {
    queue.current = queue.queue[0] || null;
    setActiveDriver(roverId, queue.current);
    clearTimeout(queue.timer);
    return;
  }
  const idx = queue.queue.findIndex((id) => id === queue.current);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % queue.queue.length;
  queue.current = queue.queue[nextIdx];
  setActiveDriver(roverId, queue.current);
  sendAlert({ color: COLORS.info, title: 'Turn switch', message: `${queue.current} now controls ${roverId}` });
  stopRover(roverId);
  scheduleNextTurn(roverId);
}

function setActiveDriver(roverId, socketId) {
  if (!socketId) {
    activeDrivers.delete(roverId);
  } else {
    activeDrivers.set(roverId, socketId);
  }
  turnEvents.emit('activeDriver', { roverId, socketId });
}

function getActiveDrivers() {
  const map = {};
  activeDrivers.forEach((socketId, roverId) => {
    map[roverId] = socketId;
  });
  return map;
}

function stopRover(roverId) {
  try {
    const { issueCommand } = require('./commandService');
    issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
    issueCommand(roverId, { type: 'motors', motorPwm: { main: 0, side: 0, vacuum: 0 } });
  } catch (err) {
    // best effort; log elsewhere if needed
  }
}

modeEvents.on('change', (mode) => {
  driverQueues.forEach((_, roverId) => syncState(roverId));
});

module.exports = {
  driverAdded,
  driverRemoved,
  cleanupRover,
  canDrive,
  getActiveDrivers,
  turnEvents,
};
