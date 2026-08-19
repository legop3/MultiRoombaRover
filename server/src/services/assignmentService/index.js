// assignment Service
// Purpose: Defines the assignment Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('assignment');
const { MODES, getMode, modeEvents } = require('../modeManager');
const { roleEvents, getRole, isAdmin, isLockdownAdmin } = require('../roleService');
const roverManager = require('../roverManager');
const { compareRoversForAssignment } = require('./roverRanking');

const socketRefs = new Map(); // socketId -> socket
const assignments = new Map(); // socketId -> roverId
const waiting = new Set(); // socketIds waiting for placement
const assignmentEvents = new EventEmitter();

function normalizeRemovalMessage(message, fallback) {
  /*
    Removal notices are shown directly in the driving UI, so the server trims
    caller-provided text before emitting it. Keeping this normalization close to
    the release helper makes every forced-removal path use the same readable
    fallback instead of forcing each caller to duplicate defensive string checks.
  */
  const clean = String(message || '').trim();
  return clean || fallback;
}

function emitRemovalNotice(socket, notice = {}) {
  /*
    The browser may lose its rover assignment in the same server tick that the
    reason is generated. Sending a dedicated event before releasing control lets
    the client preserve the explanation even after normal session sync says the
    user no longer has an assigned rover.
  */
  if (!socket) return;
  const roverId = String(notice.roverId || '').trim() || null;
  const message = normalizeRemovalMessage(notice.message, 'You were removed from the rover.');
  socket.emit('session:roverRemovalNotice', {
    roverId,
    title: normalizeRemovalMessage(notice.title, 'Removed from rover'),
    message,
    reasonCode: String(notice.reasonCode || 'removed').trim() || 'removed',
    actor: notice.actor || null,
    ts: Date.now(),
  });
}

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

function forceReleaseWithNotice(roverId, socketId, notice = {}) {
  /*
    This is the one public path for moderation-style removals. It deliberately
    emits the explanation before forceRelease mutates assignment state, because
    session sync listeners can update the UI immediately after the release and
    the UI needs the reason to already be in local state.
  */
  const socket = socketRefs.get(socketId) || io.sockets.sockets.get(socketId);
  emitRemovalNotice(socket, { ...notice, roverId });
  forceRelease(roverId, socketId);
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
  /*
    Eligibility is resolved above, while this shared comparator owns only the
    requested placement order: empty, undocked when empty, driver count, then
    battery percentage.
    Keeping those concerns separate prevents a ranking change from weakening
    lock, private-rover, role, or mode access checks.
  */
  candidates.sort(compareRoversForAssignment);
  const best = candidates[0];
  if (!best) return null;
  const bestTier = candidates.filter((entry) => compareRoversForAssignment(entry, best) === 0);
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
  forceReleaseWithNotice,
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
