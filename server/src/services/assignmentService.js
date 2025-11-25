const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('assignment');
const { MODES, getMode, modeEvents } = require('./modeManager');
const { roleEvents, getRole, isAdmin } = require('./roleService');
const roverManager = require('./roverManager');

const socketRefs = new Map(); // socketId -> socket
const assignments = new Map(); // socketId -> roverId
const waiting = new Set(); // socketIds waiting for placement
const assignmentEvents = new EventEmitter();

io.on('connection', (socket) => {
  socketRefs.set(socket.id, socket);
  socket.on('disconnect', () => {
    socketRefs.delete(socket.id);
    unassignSocket(socket);
  });
});

roleEvents.on('change', ({ socket, role }) => {
  if (!socket || !socket.id) return;
  if (role === 'user') {
    assignSocket(socket);
  } else {
    unassignSocket(socket);
  }
});

modeEvents.on('change', (mode) => {
  if (mode === MODES.ADMIN || mode === MODES.LOCKDOWN) {
    // release non-admin drivers
    for (const [socketId, roverId] of assignments.entries()) {
      const socket = socketRefs.get(socketId);
      if (socket && !isAdmin(socket)) {
        releaseAssignment(socket, roverId);
      }
    }
  }
  reassignWaiting();
});

roverManager.managerEvents.on('lock', ({ roverId, locked }) => {
  if (locked) {
    reassignFromRover(roverId);
  } else {
    reassignWaiting();
  }
});

roverManager.managerEvents.on('rover', ({ action }) => {
  if (action === 'removed' || action === 'upsert') {
    reassignWaiting();
  }
});

function assignSocket(socket) {
  if (!socket || isAdmin(socket) || getRole(socket) !== 'user') {
    return;
  }
  // avoid double assignment
  if (assignments.has(socket.id)) {
    return;
  }
  const target = pickRover();
  if (!target) {
    waiting.add(socket.id);
    logger.info('No rover available, user waiting', socket.id);
    assignmentEvents.emit('update', socket.id);
    return;
  }
  try {
    roverManager.requestControl(target.id, socket, { allowUser: true });
    assignments.set(socket.id, target.id);
    waiting.delete(socket.id);
    logger.info('Assigned user to rover', socket.id, target.id);
    assignmentEvents.emit('update', socket.id);
  } catch (err) {
    logger.warn('Failed to assign user', err.message);
    waiting.add(socket.id);
    assignmentEvents.emit('update', socket.id);
  }
}

function unassignSocket(socket) {
  if (!socket) return;
  waiting.delete(socket.id);
  const roverId = assignments.get(socket.id);
  if (roverId) {
    roverManager.releaseControl(roverId, socket);
    assignments.delete(socket.id);
    logger.info('Unassigned socket from rover', socket.id, roverId);
    assignmentEvents.emit('update', socket.id);
  }
}

function reassignFromRover(roverId) {
  for (const [socketId, rid] of assignments.entries()) {
    if (rid !== roverId) continue;
    const socket = socketRefs.get(socketId);
    if (!socket) {
      assignments.delete(socketId);
      continue;
    }
    roverManager.releaseControl(rid, socket);
    assignments.delete(socketId);
    assignSocket(socket);
    assignmentEvents.emit('update', socketId);
  }
}

function reassignWaiting() {
  for (const socketId of Array.from(waiting)) {
    const socket = socketRefs.get(socketId);
    if (socket) {
      assignSocket(socket);
    } else {
      waiting.delete(socketId);
    }
    assignmentEvents.emit('update', socketId);
  }
}

function releaseAssignment(socket, roverId) {
  roverManager.releaseControl(roverId, socket);
  assignments.delete(socket.id);
  waiting.add(socket.id);
  logger.info('Released assignment back to queue', socket.id, roverId);
  assignmentEvents.emit('update', socket.id);
}

function forceRelease(roverId, socketId) {
  const socket = socketRefs.get(socketId) || io.sockets.sockets.get(socketId);
  if (assignments.get(socketId) === roverId) {
    assignments.delete(socketId);
  }
  waiting.delete(socketId);
  if (socket) {
    roverManager.releaseControl(roverId, socket);
    logger.info('Force released socket from rover', socketId, roverId);
  } else {
    logger.warn('Force release: socket not found', socketId, roverId);
  }
  assignmentEvents.emit('update', socketId);
}

function pickRover() {
  const mode = getMode();
  if (mode === MODES.ADMIN || mode === MODES.LOCKDOWN) {
    return null;
  }
  const candidates = Array.from(roverManager.rovers.values()).filter((rover) => {
    if (!rover || rover.locked) return false;
    return true;
  });
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => a.drivers.size - b.drivers.size);
  return candidates[0];
}

function describeAssignment(socketId) {
  const assignedRoverId = assignments.get(socketId) || null;
  const adminRoverId = assignedRoverId ? null : roverManager.getPrimaryRoverForSocket(socketId);
  const waitingIndex = waiting.has(socketId) ? Array.from(waiting).indexOf(socketId) : -1;
  const roverId = assignedRoverId || adminRoverId || null;
  const waitingStatus = waiting.has(socketId);
  return {
    roverId,
    status: assignedRoverId ? 'assigned' : adminRoverId ? 'admin' : waitingStatus ? 'waiting' : null,
    queuePosition: waitingIndex >= 0 ? waitingIndex + 1 : null,
  };
}

module.exports = {
  assignmentEvents,
  describeAssignment,
  forceRelease,
};
