const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('assignment');
const { MODES, getMode, modeEvents } = require('./modeManager');
const { roleEvents, getRole, isAdmin, isLockdownAdmin } = require('./roleService');
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
  if (mode === MODES.ADMIN) {
    for (const [socketId, roverId] of assignments.entries()) {
      const socket = socketRefs.get(socketId);
      if (socket && !isAdmin(socket)) {
        releaseAssignment(socket, roverId);
      }
    }
  } else if (mode === MODES.LOCKDOWN) {
    for (const [socketId, roverId] of assignments.entries()) {
      const socket = socketRefs.get(socketId);
      if (socket && !isLockdownAdmin(socket)) {
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

roverManager.managerEvents.on('private', ({ roverId, open }) => {
  if (open) {
    reassignWaiting();
  } else {
    reassignFromRover(roverId);
  }
});

roverManager.managerEvents.on('rover', ({ action }) => {
  if (action === 'removed' || action === 'upsert') {
    reassignWaiting();
  }
});

roverManager.managerEvents.on('switch', ({ socketId, roverId }) => {
  if (!socketId || !roverId) return;
  const socket = socketRefs.get(socketId);
  if (!socket) return;
  assignments.set(socketId, roverId);
  waiting.delete(socketId);
  assignmentEvents.emit('update', socketId);
});

function assignSocket(socket, options = {}) {
  if (!socket || isAdmin(socket) || getRole(socket) !== 'user') {
    return;
  }
  // avoid double assignment
  if (assignments.has(socket.id)) {
    return;
  }
  const target = pickRover(socket, {
    excludeRoverId: options.excludeRoverId || null,
  });
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
    const access = roverManager.canRequestControl(roverId, socket, { allowUser: true });
    if (access.ok) {
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

function pickRover(socket, options = {}) {
  const mode = getMode();
  if (mode === MODES.ADMIN || mode === MODES.LOCKDOWN) {
    return null;
  }
  const allCandidates = Array.from(roverManager.rovers.values()).filter((rover) => {
    if (!rover || rover.locked) return false;
    const access = roverManager.canRequestControl(rover.id, socket, { allowUser: true });
    if (!access.ok) return false;
    return true;
  });
  let candidates = allCandidates;
  const excludeRoverId = options?.excludeRoverId || null;
  if (excludeRoverId) {
    const withoutExcluded = allCandidates.filter((rover) => String(rover.id) !== String(excludeRoverId));
    if (withoutExcluded.length > 0) {
      candidates = withoutExcluded;
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  const dockedRank = (rover) => {
    if (!rover) return 0;
    if (rover.docked === true) return -1;
    if (rover.docked === false) return 1;
    const sensors = rover.lastSensor?.decoded || rover.lastSensor?.sensors || null;
    const docked = sensors?.chargingSources?.homeBase;
    if (docked === true) return -1;
    if (docked === false) return 1;
    return 0;
  };
  const idleRank = (rover) => (rover?.drivers?.size === 0 ? 1 : 0);
  const compare = (a, b) => {
    const aEmpty = idleRank(a);
    const bEmpty = idleRank(b);
    if (aEmpty !== bEmpty) return bEmpty - aEmpty;
    const aDockRank = dockedRank(a);
    const bDockRank = dockedRank(b);
    if (aEmpty === 1 && aDockRank !== bDockRank) {
      return bDockRank - aDockRank;
    }
    if (a.drivers.size !== b.drivers.size) {
      return a.drivers.size - b.drivers.size;
    }
    return bDockRank - aDockRank;
  };
  candidates.sort(compare);
  const best = candidates[0];
  if (!best) return null;
  const bestTier = candidates.filter((entry) => compare(entry, best) === 0);
  if (!bestTier.length) return best;
  return bestTier[Math.floor(Math.random() * bestTier.length)] || best;
}

function rerollAssignments() {
  const users = Array.from(socketRefs.values()).filter((socket) => socket && getRole(socket) === 'user');
  const previous = new Map(users.map((socket) => [socket.id, assignments.get(socket.id) || null]));
  users.forEach((socket) => {
    unassignSocket(socket);
  });
  let moved = 0;
  users.forEach((socket) => {
    const prevRover = previous.get(socket.id) || null;
    assignSocket(socket, { excludeRoverId: prevRover });
    const nextRover = assignments.get(socket.id) || null;
    if (nextRover && prevRover && String(nextRover) !== String(prevRover)) {
      moved += 1;
    }
  });
  return moved;
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
  rerollAssignments,
  getAssignedRover: (socketId) => assignments.get(socketId) || null,
  moveAssignment: (socket, roverId, { releasePrevious = true } = {}) => {
    if (!socket || !roverId) return;
    const previous = assignments.get(socket.id);
    if (previous && previous !== roverId && releasePrevious) {
      roverManager.releaseControl(previous, socket);
    }
    assignments.set(socket.id, roverId);
    waiting.delete(socket.id);
    assignmentEvents.emit('update', socket.id);
  },
};
