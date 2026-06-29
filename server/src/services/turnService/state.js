// state
// Purpose: Defines the state module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const EventEmitter = require('events');

const driverQueues = new Map();
const activeDrivers = new Map();
const turnEvents = new EventEmitter();
const turnDeadlines = new Map();
const idleDeadlines = new Map();
const idleTimers = new Map();
const idleSkips = new Map();
const idleDisarmed = new Map();

function ensureQueue(roverId) {
  if (!driverQueues.has(roverId)) {
    driverQueues.set(roverId, {
      queue: [],
      current: null,
      timer: null,
      /*
        Admin force-control is intentionally modeled as a queue pause instead of
        a queue replacement. That keeps every regular driver's relative place
        intact while making the admin takeover immune to normal turn rotation.
      */
      pausedByAdminSocketId: null,
    });
  }
  return driverQueues.get(roverId);
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

module.exports = {
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
};
