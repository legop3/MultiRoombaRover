// turn Service
// Purpose: Defines the turn Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const io = require('../../globals/io');
const { sendAlert } = require('../alertService');
const { MODES, getMode, modeEvents } = require('../modeManager');
const {
  ALERT_COLOR,
  TURN_DURATION_MS,
  IDLE_TIMEOUT_MS,
  MAX_IDLE_SKIPS,
  STALE_REAPER_MS,
} = require('./constants');
const {
  driverQueues,
  activeDrivers,
  turnEvents,
  turnDeadlines,
  idleDeadlines,
  idleTimers,
  idleSkips,
  idleDisarmed,
  ensureQueue,
  setActiveDriver,
  getActiveDrivers,
} = require('./state');
const { stopRover, removeDriverCompletely } = require('./actions');

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
    stopRover(roverId);
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

function isQueuedDriver(roverId, socketId) {
  if (!socketId) return false;
  const queue = driverQueues.get(roverId);
  if (!queue) return false;
  return queue.queue.includes(socketId);
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
      color: ALERT_COLOR,
      title: 'Driver removed',
      message: `${expectedDriver} removed from ${roverId} after ${skips} idle skips`,
    });
    removeDriverCompletely(roverId, expectedDriver);
    return;
  }
  sendAlert({
    color: ALERT_COLOR,
    title: 'Turn skipped',
    message: `${expectedDriver} skipped on ${roverId} (idle ${skips}/${MAX_IDLE_SKIPS})`,
  });
  advanceTurn(roverId);
}

function advanceTurn(roverId) {
  const queue = driverQueues.get(roverId);
  if (!queue) return;
  if (queue.queue.length === 0) {
    stopRover(roverId);
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
  sendAlert({ color: ALERT_COLOR, title: 'Turn switch', message: `${queue.current} now controls ${roverId}` });
  stopRover(roverId);
  scheduleNextTurn(roverId);
  scheduleIdleTimer(roverId);
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

function recordActivity(roverId, socketId) {
  const queue = driverQueues.get(roverId);
  if (!queue || queue.current !== socketId) return;
  if (idleDisarmed.get(roverId)) return;
  idleDisarmed.set(roverId, true);
  const hadDeadline = idleDeadlines.has(roverId);
  clearTimeout(idleTimers.get(roverId));
  idleDeadlines.delete(roverId);
  if (hadDeadline) {
    turnEvents.emit('queue', { roverId, reason: 'activity' });
  }
}

modeEvents.on('change', (mode) => {
  driverQueues.forEach((_, roverId) => syncState(roverId));
});

function reapStaleDrivers() {
  const staleIds = new Set();
  driverQueues.forEach((queue) => {
    queue.queue.forEach((socketId) => {
      if (!io.sockets.sockets.has(socketId)) {
        staleIds.add(socketId);
      }
    });
    if (queue.current && !io.sockets.sockets.has(queue.current)) {
      staleIds.add(queue.current);
    }
  });
  if (staleIds.size === 0) return;
  driverQueues.forEach((queue, roverId) => {
    staleIds.forEach((socketId) => {
      if (queue.current === socketId || queue.queue.includes(socketId)) {
        driverRemoved(roverId, socketId);
      }
    });
  });
}

setInterval(reapStaleDrivers, STALE_REAPER_MS);

module.exports = {
  driverAdded,
  driverRemoved,
  cleanupRover,
  canDrive,
  isQueuedDriver,
  getActiveDrivers,
  turnEvents,
  getTurnQueues,
  recordActivity,
};
