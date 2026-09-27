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

function normalizeDriverAddOptions(options = {}) {
  if (typeof options === 'boolean') {
    return { force: options, pauseQueue: false };
  }
  return {
    force: Boolean(options?.force),
    pauseQueue: Boolean(options?.pauseQueue),
  };
}

function clearTurnTimer(roverId, queue) {
  /*
    Timer cleanup is centralized because normal turn end, non-turn modes, admin
    pauses, and empty queues all need the same invariant: no stale timeout should
    be left behind that can rotate the queue later.
  */
  if (queue) clearTimeout(queue.timer);
  turnDeadlines.delete(roverId);
}

function clearIdleTimer(roverId) {
  /*
    The idle timer is separate from the turn timer because idle skips are about
    user activity inside a turn. Admin takeover pauses both systems, while normal
    activity only disarms the idle timer for the current turn.
  */
  clearTimeout(idleTimers.get(roverId));
  idleDeadlines.delete(roverId);
  idleTimers.delete(roverId);
}

function clearQueueTimers(roverId, queue) {
  clearTurnTimer(roverId, queue);
  clearIdleTimer(roverId);
}

function isQueuePaused(queue) {
  return Boolean(
    queue &&
    queue.pausedByAdminSocketId &&
    queue.current === queue.pausedByAdminSocketId &&
    queue.queue.includes(queue.pausedByAdminSocketId),
  );
}

function clearInvalidAdminPause(queue) {
  /*
    A pause only means something while that admin socket is still in the queue.
    Disconnect cleanup and release paths remove sockets first, so this guard lets
    the rest of the turn code safely resume without needing special stale-state
    branches everywhere.
  */
  if (!queue?.pausedByAdminSocketId) return;
  if (queue.queue.includes(queue.pausedByAdminSocketId)) return;
  queue.pausedByAdminSocketId = null;
}

function syncPausedQueue(roverId, queue) {
  /*
    During admin takeover, the queue is deliberately frozen: the admin stays at
    the front and active, existing users keep their order behind the admin, and
    no turn or idle timeout is allowed to remove the admin from control.
  */
  setActiveDriver(roverId, queue.pausedByAdminSocketId);
  clearQueueTimers(roverId, queue);
  idleDisarmed.delete(roverId);
  turnEvents.emit('queue', { roverId, reason: 'admin-pause' });
}

function applyAdminQueuePause(roverId, socketId, queue) {
  /*
    Force-control should be a takeover, not a destructive queue reset. Moving the
    admin to index 0 makes the visible queue match control ownership, while the
    filter preserves every other driver's relative order for when the admin
    releases the rover.
  */
  queue.queue = [socketId, ...queue.queue.filter((id) => id !== socketId)];
  queue.current = socketId;
  queue.pausedByAdminSocketId = socketId;
  syncPausedQueue(roverId, queue);
}

function driverAdded(roverId, socketId, options = {}) {
  const { force, pauseQueue } = normalizeDriverAddOptions(options);
  const queue = ensureQueue(roverId);
  const alreadyQueued = queue.queue.includes(socketId);
  const previousQueueLength = queue.queue.length;

  if (pauseQueue) {
    applyAdminQueuePause(roverId, socketId, queue);
    return;
  }

  if (!alreadyQueued) {
    queue.queue.push(socketId);
  }

  /*
    Re-requesting the same rover must not be treated as a fresh queue mutation.
    The old behavior always called syncState(), which always rebuilt the turn
    timeout in multi-driver turns mode and let the current driver extend a turn
    forever by clicking their rover again.
  */
  if (alreadyQueued && queue.current && !force) {
    clearInvalidAdminPause(queue);
    if (isQueuePaused(queue)) {
      syncPausedQueue(roverId, queue);
    } else {
      turnEvents.emit('queue', { roverId, reason: 'duplicate-driver-request' });
    }
    return;
  }

  if (!queue.current || force) {
    queue.current = socketId;
  }

  /*
    A normal join changes who will receive a future turn; it does not begin a
    new turn for the person who is already driving. Preserve both deadlines and
    the current driver's activity state while an already-rotating queue grows.

    The one-to-two transition is intentionally different. Before the second
    driver arrives there is no reason to time the sole driver, so this is the
    moment the first real rotating turn begins. A forced grant also changes the
    active driver immediately and therefore starts that driver's fresh turn.
  */
  const turnsAreRotating = getMode() === MODES.TURNS && queue.queue.length > 1;
  const beginsRotatingTurns = turnsAreRotating && previousQueueLength <= 1;
  if (turnsAreRotating && (force || beginsRotatingTurns)) {
    startCurrentTurn(roverId, queue);
    return;
  }

  if (turnsAreRotating) {
    setActiveDriver(roverId, queue.current);
    turnEvents.emit('queue', { roverId, reason: 'driver-joined' });
    return;
  }

  syncState(roverId);
}

function driverRemoved(roverId, socketId) {
  const queue = driverQueues.get(roverId);
  if (!queue) return;
  queue.queue = queue.queue.filter((id) => id !== socketId);
  if (queue.pausedByAdminSocketId === socketId) {
    /*
      Releasing or disconnecting the pausing admin is the handoff point back to
      normal turns. The users were never removed, so advanceTurn() can resume at
      the first preserved user after the admin has been filtered out above.
    */
    queue.pausedByAdminSocketId = null;
  } else {
    clearInvalidAdminPause(queue);
  }
  const skips = idleSkips.get(roverId);
  if (skips) {
    skips.delete(socketId);
    if (skips.size === 0) {
      idleSkips.delete(roverId);
    }
  }
  if (queue.current === socketId) {
    /*
      Removing the active driver is a real handoff. advanceTurn() owns clearing
      the old turn state and creating the next driver's deadlines, keeping this
      path identical for explicit release, disconnect, and stale-socket reap.
    */
    stopRover(roverId);
    advanceTurn(roverId);
    return;
  }

  /*
    A waiting driver leaving must not re-arm idle detection or extend the
    unrelated active driver's turn. If this removal ends rotation entirely,
    syncState() clears both deadlines immediately; otherwise only the public
    queue membership changes.
  */
  if (getMode() !== MODES.TURNS || queue.queue.length <= 1) {
    syncState(roverId);
    return;
  }
  if (isQueuePaused(queue)) {
    turnEvents.emit('queue', { roverId, reason: 'driver-left-admin-pause' });
    return;
  }
  turnEvents.emit('queue', { roverId, reason: 'driver-left' });
}

function cleanupRover(roverId) {
  const queue = driverQueues.get(roverId);
  if (queue) {
    clearTimeout(queue.timer);
  }
  clearIdleTimer(roverId);
  driverQueues.delete(roverId);
  activeDrivers.delete(roverId);
  turnDeadlines.delete(roverId);
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

function canRequestLiveVideo(roverId, socket) {
  if (!socket) return false;
  if (canDrive(roverId, socket)) return true;

  const queue = driverQueues.get(roverId);
  if (!queue || getMode() !== MODES.TURNS) {
    return false;
  }

  /*
    This helper is intentionally broader than canDrive(). Bandwidth saving is a
    presentation/subscription decision for normal driver clients: the UI keeps
    non-current drivers on snapshots, and only asks for live video when it wants
    to warm or show the stream. The server should still verify that the socket is
    actually attached to this rover, but it should not reject a legitimate queued
    driver because the browser and turn timer are a few milliseconds out of sync.
  */
  return queue.queue.includes(socket.id);
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
  clearInvalidAdminPause(queue);
  if (isQueuePaused(queue)) {
    syncPausedQueue(roverId, queue);
    return;
  }
  if (mode !== MODES.TURNS || queue.queue.length <= 1) {
    queue.current = queue.queue[0] || null;
    setActiveDriver(roverId, queue.current);
    clearQueueTimers(roverId, queue);
    idleDisarmed.delete(roverId);
    turnEvents.emit('queue', { roverId });
    return;
  }
  if (!queue.current) {
    queue.current = queue.queue[0];
  }
  /*
    syncState() is used when entering turns mode and when a previously untimed
    queue becomes rotatable. Both cases begin a genuine turn rather than merely
    publishing a membership update.
  */
  startCurrentTurn(roverId, queue);
}

function startCurrentTurn(roverId, queue) {
  /*
    This is the sole normal entry point for a fresh timed turn. Keeping active
    ownership, the full-turn deadline, and the activity grace window together
    prevents callers from resetting only part of the lifecycle.
  */
  setActiveDriver(roverId, queue.current);
  idleDisarmed.set(roverId, false);
  scheduleNextTurn(roverId);
  scheduleIdleTimer(roverId);
}

function scheduleNextTurn(roverId) {
  const queue = driverQueues.get(roverId);
  if (!queue) return;
  if (isQueuePaused(queue)) {
    syncPausedQueue(roverId, queue);
    return;
  }
  clearTimeout(queue.timer);
  const deadline = Date.now() + TURN_DURATION_MS;
  turnDeadlines.set(roverId, deadline);
  queue.timer = setTimeout(() => advanceTurn(roverId), TURN_DURATION_MS);
  turnEvents.emit('queue', { roverId });
}

function scheduleIdleTimer(roverId) {
  const queue = driverQueues.get(roverId);
  clearIdleTimer(roverId);
  if (
    !queue ||
    isQueuePaused(queue) ||
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
    const removalMessage = `You were removed from ${roverId} after ${skips} idle skips because no driving input was detected during your turns.`;
    sendAlert({
      color: ALERT_COLOR,
      title: 'Driver removed',
      message: `${expectedDriver} removed from ${roverId} after ${skips} idle skips`,
    });
    removeDriverCompletely(roverId, expectedDriver, {
      title: 'Removed for inactivity',
      message: removalMessage,
      reasonCode: 'idle-removal',
    });
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
  clearInvalidAdminPause(queue);
  if (isQueuePaused(queue)) {
    syncPausedQueue(roverId, queue);
    return;
  }
  if (queue.queue.length === 0) {
    stopRover(roverId);
    clearTurnTimer(roverId, queue);
    setActiveDriver(roverId, null);
    clearIdleTimer(roverId);
    idleDisarmed.delete(roverId);
    turnEvents.emit('queue', { roverId });
    return;
  }
  const mode = getMode();
  if (mode !== MODES.TURNS || queue.queue.length <= 1) {
    queue.current = queue.queue[0] || null;
    setActiveDriver(roverId, queue.current);
    clearQueueTimers(roverId, queue);
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
      pausedByAdminSocketId: queue.pausedByAdminSocketId || null,
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

/*
  Stale cleanup should run for the lifetime of the server, but it should not by
  itself keep short-lived tools or the Node test runner alive after their work
  has completed.
*/
setInterval(reapStaleDrivers, STALE_REAPER_MS).unref();

module.exports = {
  driverAdded,
  driverRemoved,
  cleanupRover,
  canDrive,
  canRequestLiveVideo,
  isQueuedDriver,
  getActiveDrivers,
  turnEvents,
  getTurnQueues,
  recordActivity,
};
