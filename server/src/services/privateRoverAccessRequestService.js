const crypto = require('crypto');
const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('privateRoverAccessRequest');
const { publishEvent } = require('./eventBus');
const roverManager = require('./roverManager');
const { getNickname } = require('./nicknameService');
const { getRole, isLockdownAdmin } = require('./roleService');
const { getSocketIp, normalizeIp } = require('../helpers/ipResolver');

const requestEvents = new EventEmitter();
const REQUEST_COOLDOWN_MS = 15 * 1000;
const DM_APPROVE_EMOJI = '✅';
const DM_DENY_EMOJI = '❌';

const pendingRequests = new Map(); // requestId -> request
const pendingByRequesterRover = new Map(); // `${requesterKey}:${roverId}` -> requestId
const lastRequestAtByRequester = new Map(); // requesterKey -> ts
const dmMessages = new Map(); // messageId -> { requestId, adminDiscordId, createdAt }
const grants = new Map(); // `${requesterKey}:${roverId}` -> { requesterKey, roverId, grantedAt, grantedBy, requestId }

function normalizeRoverId(value) {
  return String(value || '').trim();
}

function buildRequesterKey(socket) {
  const cookieUserId = String(socket?.data?.cookieUserId || '').trim().toLowerCase();
  if (cookieUserId) return `cookie:${cookieUserId}`;
  return `socket:${socket?.id || 'unknown'}`;
}

function normalizeRequesterKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildGrantKey(requesterKey, roverId) {
  return `${normalizeRequesterKey(requesterKey)}:${normalizeRoverId(roverId)}`;
}

function isClosedPrivateRoverRecord(record) {
  return Boolean(record?.private?.enabled && !record?.privateOpen);
}

function listClosedPrivateRovers() {
  const records = Array.from(roverManager.rovers.values())
    .filter((record) => isClosedPrivateRoverRecord(record))
    .map((record) => ({
      id: String(record.id),
      name: record.meta?.name || record.id,
      color: record.meta?.color || null,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return records;
}

function listPendingForRequester(socket) {
  const requesterKey = buildRequesterKey(socket);
  const pending = [];
  for (const request of pendingRequests.values()) {
    if (request.requesterKey !== requesterKey) continue;
    if (request.status !== 'pending') continue;
    pending.push({
      id: request.id,
      roverId: request.roverId,
      roverName: request.roverName,
      createdAt: request.createdAt,
      status: request.status,
    });
  }
  pending.sort((a, b) => b.createdAt - a.createdAt);
  return pending;
}

function getStateForSocket(socket) {
  const requesterKey = buildRequesterKey(socket);
  const grantedRovers = [];
  for (const grant of grants.values()) {
    if (grant.requesterKey !== requesterKey) continue;
    grantedRovers.push({
      roverId: grant.roverId,
      grantedAt: grant.grantedAt,
      requestId: grant.requestId || null,
    });
  }
  grantedRovers.sort((a, b) => b.grantedAt - a.grantedAt);
  return {
    requestableRovers: listClosedPrivateRovers(),
    pendingRequests: listPendingForRequester(socket),
    grantedRovers,
  };
}

function clearPendingRequest(request, reason = 'resolved') {
  if (!request || request.status !== 'pending') return;
  request.status = reason;
  request.resolvedAt = Date.now();
  pendingByRequesterRover.delete(`${request.requesterKey}:${request.roverId}`);
  requestEvents.emit('change', { reason, requestId: request.id, roverId: request.roverId });
}

function clearPendingForRover(roverId, reason = 'resolved') {
  const target = normalizeRoverId(roverId);
  for (const request of pendingRequests.values()) {
    if (request.status !== 'pending') continue;
    if (String(request.roverId) !== target) continue;
    clearPendingRequest(request, reason);
  }
}

function getGrantForRequester(requesterKey, roverId) {
  if (!requesterKey || !roverId) return null;
  return grants.get(buildGrantKey(requesterKey, roverId)) || null;
}

function hasClosedPrivateAccessForSocket(socket, roverId) {
  if (!socket || !roverId) return false;
  const requesterKey = buildRequesterKey(socket);
  return Boolean(getGrantForRequester(requesterKey, roverId));
}

function listGrantedRoversForRequester(requesterKey) {
  const key = normalizeRequesterKey(requesterKey);
  if (!key) return [];
  const roverIds = [];
  for (const grant of grants.values()) {
    if (grant.requesterKey !== key) continue;
    roverIds.push(grant.roverId);
  }
  return Array.from(new Set(roverIds));
}

function applySocketGrantCache(socket) {
  if (!socket) return;
  socket.data = socket.data || {};
  const requesterKey = buildRequesterKey(socket);
  socket.data.privateClosedAccessRovers = listGrantedRoversForRequester(requesterKey);
}

function findPendingRequestById(requestId) {
  const id = String(requestId || '').trim();
  if (!id) return null;
  const request = pendingRequests.get(id);
  if (!request || request.status !== 'pending') return null;
  return request;
}

function attachDmMessage(requestId, messageId, adminDiscordId = null) {
  const rid = String(requestId || '').trim();
  const mid = String(messageId || '').trim();
  if (!rid || !mid) return;
  dmMessages.set(mid, {
    requestId: rid,
    adminDiscordId: adminDiscordId ? String(adminDiscordId) : null,
    createdAt: Date.now(),
  });
}

function getRequestByMessageId(messageId) {
  const mid = String(messageId || '').trim();
  if (!mid) return null;
  const map = dmMessages.get(mid);
  if (!map) return null;
  const request = pendingRequests.get(map.requestId) || null;
  if (!request) return null;
  return { request, map };
}

function getSocketByRequesterKey(requesterKey) {
  if (!requesterKey) return null;
  if (requesterKey.startsWith('socket:')) {
    const socketId = requesterKey.slice('socket:'.length);
    return io.sockets.sockets.get(socketId) || null;
  }
  return null;
}

function tryAssignClosedPrivateRover(socket, roverId) {
  if (!socket || !roverId) return false;
  const record = roverManager.rovers.get(String(roverId));
  if (!record) return false;
  const access = roverManager.canRequestControl(roverId, socket, { allowUser: true });
  if (!access.ok) {
    throw new Error(access.reason || 'Control denied');
  }
  const previousJoined = roverManager.getRoversForSocket(socket.id);
  roverManager.requestControl(roverId, socket, { allowUser: true });
  previousJoined.forEach((rid) => {
    if (rid !== roverId) {
      roverManager.releaseControl(rid, socket);
    }
  });
  roverManager.managerEvents.emit('switch', { socketId: socket.id, roverId: String(roverId) });
  try {
    const assignmentService = require('./assignmentService');
    assignmentService.moveAssignment(socket, String(roverId), { releasePrevious: false });
  } catch (err) {
    logger.warn('Failed to move assignment after private access grant', { socketId: socket.id, error: err.message });
  }
  socket.emit('controlGranted', { roverId: String(roverId) });
  return true;
}

function approveRequest(requestId, actorDiscordId = null) {
  const request = findPendingRequestById(requestId);
  if (!request) {
    throw new Error('Request not found or already resolved.');
  }
  request.status = 'approved';
  request.resolvedAt = Date.now();
  request.resolvedBy = actorDiscordId ? String(actorDiscordId) : null;
  pendingByRequesterRover.delete(`${request.requesterKey}:${request.roverId}`);

  const grantKey = buildGrantKey(request.requesterKey, request.roverId);
  grants.set(grantKey, {
    requesterKey: request.requesterKey,
    roverId: request.roverId,
    requestId: request.id,
    grantedAt: Date.now(),
    grantedBy: request.resolvedBy,
  });

  let assignedSocketId = null;
  const socket = getSocketByRequesterKey(request.requesterKey);
  if (socket) {
    applySocketGrantCache(socket);
    try {
      if (tryAssignClosedPrivateRover(socket, request.roverId)) {
        assignedSocketId = socket.id;
      }
    } catch (err) {
      logger.warn('Private rover access approved but assignment failed', {
        requestId: request.id,
        roverId: request.roverId,
        socketId: socket.id,
        error: err.message,
      });
    }
  }

  publishEvent({
    source: 'privateRoverAccessRequest',
    type: 'privateRoverAccess.resolved',
    payload: {
      requestId: request.id,
      decision: 'approved',
      roverId: request.roverId,
      requesterKey: request.requesterKey,
      resolvedBy: request.resolvedBy,
      resolvedAt: request.resolvedAt,
      assignedSocketId,
    },
  });
  requestEvents.emit('change', {
    reason: 'approved',
    requestId: request.id,
    roverId: request.roverId,
    socketId: assignedSocketId,
  });
  return { request, assignedSocketId };
}

function denyRequest(requestId, actorDiscordId = null) {
  const request = findPendingRequestById(requestId);
  if (!request) {
    throw new Error('Request not found or already resolved.');
  }
  request.status = 'denied';
  request.resolvedAt = Date.now();
  request.resolvedBy = actorDiscordId ? String(actorDiscordId) : null;
  pendingByRequesterRover.delete(`${request.requesterKey}:${request.roverId}`);

  publishEvent({
    source: 'privateRoverAccessRequest',
    type: 'privateRoverAccess.resolved',
    payload: {
      requestId: request.id,
      decision: 'denied',
      roverId: request.roverId,
      requesterKey: request.requesterKey,
      resolvedBy: request.resolvedBy,
      resolvedAt: request.resolvedAt,
    },
  });
  requestEvents.emit('change', {
    reason: 'denied',
    requestId: request.id,
    roverId: request.roverId,
  });
  return { request };
}

function createRequest(socket, roverIdRaw) {
  if (!socket?.id) {
    throw new Error('Socket required');
  }
  const roverId = normalizeRoverId(roverIdRaw);
  if (!roverId) {
    throw new Error('roverId required');
  }
  const record = roverManager.rovers.get(roverId);
  if (!record) {
    throw new Error('Unknown rover');
  }
  if (!record?.private?.enabled) {
    throw new Error('Rover is not private');
  }
  if (record.privateOpen) {
    throw new Error('Private rover is already open');
  }
  if (isLockdownAdmin(socket)) {
    throw new Error('Lockdown admins can open private rovers directly');
  }

  const requesterKey = buildRequesterKey(socket);
  const dedupeKey = `${requesterKey}:${roverId}`;
  const existingId = pendingByRequesterRover.get(dedupeKey);
  if (existingId) {
    const existing = pendingRequests.get(existingId);
    if (existing && existing.status === 'pending') {
      return { request: existing, isNew: false };
    }
  }

  const now = Date.now();
  const lastAt = Number(lastRequestAtByRequester.get(requesterKey) || 0);
  if (lastAt && now - lastAt < REQUEST_COOLDOWN_MS) {
    const remaining = Math.ceil((REQUEST_COOLDOWN_MS - (now - lastAt)) / 1000);
    throw new Error(`Please wait ${remaining}s before sending another request`);
  }

  const request = {
    id: `prr_${crypto.randomBytes(8).toString('hex')}`,
    status: 'pending',
    createdAt: now,
    resolvedAt: null,
    requesterKey,
    roverId,
    roverName: record.meta?.name || record.id,
    requester: {
      socketId: socket.id,
      nickname: getNickname(socket) || null,
      role: getRole(socket),
      isVerified: Boolean(socket?.data?.isVerified),
      cookieUserId: String(socket?.data?.cookieUserId || '').trim().toLowerCase() || null,
      ip: normalizeIp(getSocketIp(socket)) || null,
    },
  };

  pendingRequests.set(request.id, request);
  pendingByRequesterRover.set(dedupeKey, request.id);
  lastRequestAtByRequester.set(requesterKey, now);

  publishEvent({
    source: 'privateRoverAccessRequest',
    type: 'privateRoverAccess.requested',
    payload: request,
  });
  requestEvents.emit('change', {
    reason: 'created',
    requestId: request.id,
    roverId: request.roverId,
    socketId: socket.id,
  });
  logger.info('Private rover access requested', {
    requestId: request.id,
    roverId: request.roverId,
    socketId: socket.id,
  });
  return { request, isNew: true };
}

roverManager.managerEvents.on('private', ({ roverId, open } = {}) => {
  if (!roverId) return;
  if (open) {
    clearPendingForRover(roverId, 'opened');
    for (const [key, grant] of grants.entries()) {
      if (String(grant.roverId) === String(roverId)) {
        grants.delete(key);
      }
    }
  }
  requestEvents.emit('change', {
    reason: 'private_state',
    roverId: String(roverId),
    open: Boolean(open),
  });
});

roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
  if (!roverId) return;
  if (action === 'removed') {
    clearPendingForRover(roverId, 'rover_removed');
    for (const [key, grant] of grants.entries()) {
      if (String(grant.roverId) === String(roverId)) {
        grants.delete(key);
      }
    }
  }
  requestEvents.emit('change', {
    reason: 'rover',
    roverId: String(roverId),
    action: action || null,
  });
});

io.on('connection', (socket) => {
  applySocketGrantCache(socket);

  function handleRequest({ roverId } = {}, cb = () => {}) {
    try {
      const { request, isNew } = createRequest(socket, roverId);
      cb({
        success: true,
        requestId: request.id,
        status: request.status,
        existing: !isNew,
      });
    } catch (err) {
      cb({ error: err.message });
    }
  }

  socket.on('privateRover:requestAccess', handleRequest);
  socket.on('session:privateRover:requestAccess', handleRequest);
  socket.on('session:identify', () => {
    applySocketGrantCache(socket);
    requestEvents.emit('change', { reason: 'identify', socketId: socket.id });
  });
});

module.exports = {
  DM_APPROVE_EMOJI,
  DM_DENY_EMOJI,
  requestEvents,
  getStateForSocket,
  createRequest,
  hasClosedPrivateAccessForSocket,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
};
