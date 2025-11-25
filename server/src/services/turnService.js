const EventEmitter = require('events');
const io = require('../globals/io');
const { sendAlert, COLORS } = require('./alertService');
const { MODES, getMode, modeEvents } = require('./modeManager');

const driverQueues = new Map(); // roverId -> { queue: [], current: socketId, timer: Timeout | null }
const activeDrivers = new Map();
const TURN_DURATION_MS = 60 * 1000;
const IDLE_TIMEOUT_MS = 7 * 1000;
const MAX_IDLE_SKIPS = 3;
const turnEvents = new EventEmitter();
const turnDeadlines = new Map(); // roverId -> timestamp when current driver expires
const idleDeadlines = new Map(); // roverId -> timestamp when idle skip will happen
const idleTimers = new Map(); // roverId -> Timeout
const idleSkips = new Map(); // roverId -> Map(socketId -> count)
const idleDisarmed = new Map(); // roverId -> boolean, true once driver has acted this turn

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
  const skips = idleSkips.get(roverId);
  if (skips) {
    skips.delete(socketId);
    if (skips.size === 0) {
      idleSkips.delete(roverId);
    }
  }
  idleDisarmed.delete(roverId);
  if (queue.current === socketId) {
    advanceTurn(roverId);
  } else {
    scheduleIdleTimer(roverId);
  }
}

function cleanupRover(roverId) {
  const queue = driverQueues.get(roverId);
  if (queue) {
    clearTimeout(queue.timer);
  }
  clearTimeout(idleTimers.get(roverId));
  driverQueues.delete(roverId);
  activeDrivers.delete(roverId);
  turnDeadlines.delete(roverId);
  idleDeadlines.delete(roverId);
  idleTimers.delete(roverId);
  idleSkips.delete(roverId);
  idleDisarmed.delete(roverId);
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
    turnDeadlines.delete(roverId);
    clearTimeout(idleTimers.get(roverId));
    idleDeadlines.delete(roverId);
    idleDisarmed.delete(roverId);
    turnEvents.emit('queue', { roverId });
    return;
  }
  if (!queue.current) {
    queue.current = queue.queue[0];
  }
  setActiveDriver(roverId, queue.current);
  idleDisarmed.set(roverId, false);
  scheduleNextTurn(roverId);
  scheduleIdleTimer(roverId);
  turnEvents.emit('queue', { roverId });
}

function scheduleNextTurn(roverId) {
  const queue = driverQueues.get(roverId);
  if (!queue) return;
  clearTimeout(queue.timer);
  const deadline = Date.now() + TURN_DURATION_MS;
  turnDeadlines.set(roverId, deadline);
  queue.timer = setTimeout(() => advanceTurn(roverId), TURN_DURATION_MS);
  turnEvents.emit('queue', { roverId });
}

function scheduleIdleTimer(roverId) {
  const queue = driverQueues.get(roverId);
  clearTimeout(idleTimers.get(roverId));
  idleDeadlines.delete(roverId);
  if (
    !queue ||
    getMode() !== MODES.TURNS ||
    queue.queue.length <= 1 ||
    !queue.current ||
    idleDisarmed.get(roverId)
  ) {
    turnEvents.emit('queue', { roverId });
    return;
  }
  const deadline = Date.now() + IDLE_TIMEOUT_MS;
  idleDeadlines.set(roverId, deadline);
  idleTimers.set(
    roverId,
    setTimeout(() => handleIdleTimeout(roverId, queue.current), IDLE_TIMEOUT_MS),
  );
  turnEvents.emit('queue', { roverId });
}

function incrementSkip(roverId, socketId) {
  if (!idleSkips.has(roverId)) {
    idleSkips.set(roverId, new Map());
  }
  const map = idleSkips.get(roverId);
  const next = (map.get(socketId) || 0) + 1;
  map.set(socketId, next);
  return next;
}

function handleIdleTimeout(roverId, expectedDriver) {
  const queue = driverQueues.get(roverId);
  if (!queue || queue.current !== expectedDriver) {
    scheduleIdleTimer(roverId);
    return;
  }
  // already acted this turn, ignore idle timeout
  if (idleDisarmed.get(roverId)) {
    scheduleIdleTimer(roverId);
    return;
  }
  const skips = incrementSkip(roverId, expectedDriver);
  stopRover(roverId);
  if (skips >= MAX_IDLE_SKIPS) {
    sendAlert({
      color: COLORS.error,
      title: 'Driver removed',
      message: `${expectedDriver} removed from ${roverId} after ${skips} idle skips`,
    });
    removeDriverCompletely(roverId, expectedDriver);
    return;
  }
  sendAlert({
    color: COLORS.warn,
    title: 'Turn skipped',
    message: `${expectedDriver} skipped on ${roverId} (idle ${skips}/${MAX_IDLE_SKIPS})`,
  });
  advanceTurn(roverId);
}

function advanceTurn(roverId) {
  const queue = driverQueues.get(roverId);
  if (!queue) return;
  if (queue.queue.length === 0) {
    clearTimeout(queue.timer);
    setActiveDriver(roverId, null);
    turnDeadlines.delete(roverId);
    idleDeadlines.delete(roverId);
    clearTimeout(idleTimers.get(roverId));
    idleTimers.delete(roverId);
    idleDisarmed.delete(roverId);
    turnEvents.emit('queue', { roverId });
    return;
  }
  const mode = getMode();
  if (mode !== MODES.TURNS || queue.queue.length <= 1) {
    queue.current = queue.queue[0] || null;
    setActiveDriver(roverId, queue.current);
    clearTimeout(queue.timer);
    turnDeadlines.delete(roverId);
    idleDeadlines.delete(roverId);
    clearTimeout(idleTimers.get(roverId));
    idleTimers.delete(roverId);
    idleDisarmed.delete(roverId);
    turnEvents.emit('queue', { roverId });
    return;
  }
  const idx = queue.queue.findIndex((id) => id === queue.current);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % queue.queue.length;
  queue.current = queue.queue[nextIdx];
  setActiveDriver(roverId, queue.current);
  idleDisarmed.set(roverId, false);
  sendAlert({ color: COLORS.info, title: 'Turn switch', message: `${queue.current} now controls ${roverId}` });
  stopRover(roverId);
  scheduleNextTurn(roverId);
  scheduleIdleTimer(roverId);
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

function getTurnQueues() {
  const mode = getMode();
  const payload = {};
  driverQueues.forEach((queue, roverId) => {
    payload[roverId] = {
      mode,
      queue: Array.from(queue.queue),
      current: queue.current,
      deadline: turnDeadlines.get(roverId) || null,
      idleDeadline: idleDeadlines.get(roverId) || null,
    };
  });
  return payload;
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

function removeDriverCompletely(roverId, socketId) {
  try {
    const assignmentService = require('./assignmentService');
    assignmentService.forceRelease(roverId, socketId);
  } catch (err) {
    // best effort; log elsewhere if needed
  }
}

function recordActivity(roverId, socketId) {
  const queue = driverQueues.get(roverId);
  if (!queue || queue.current !== socketId) return;
  idleDisarmed.set(roverId, true);
  clearTimeout(idleTimers.get(roverId));
  idleDeadlines.delete(roverId);
  turnEvents.emit('queue', { roverId });
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
  getTurnQueues,
  recordActivity,
};
