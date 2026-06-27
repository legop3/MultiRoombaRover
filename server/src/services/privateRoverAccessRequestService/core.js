// Private Rover Access Core
// Purpose: Implements request creation, grant/approval lifecycle, and requester state projection.
// Scope: Owns service business rules while keeping transport/event wiring outside this module.
const crypto = require('crypto');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('privateRoverAccessRequest');
const { publishEvent } = require('../eventBus');
const roverManager = require('../roverManager');
const { getNickname } = require('../nicknameService');
const { getRole, isLockdownAdmin } = require('../roleService');
const { getSocketIp, normalizeIp } = require('../../helpers/ipResolver');
const { getIdentitySummary, normalizeCookieUserId } = require('../identityService');
const {
  REQUEST_COOLDOWN_MS,
  GRANT_TTL_MS,
  requestEvents,
  pendingRequests,
  pendingByRequesterRover,
  lastRequestAtByRequester,
  dmMessages,
  grants,
} = require('./state');
const {
  normalizeRoverId,
  buildRequesterKey,
  normalizeRequesterKey,
  buildGrantKey,
  listClosedPrivateRovers,
  getSocketByRequesterKey,
} = require('./helpers');

function isGrantExpired(grant, now = Date.now()) {
  const expiresAt = Number(grant?.expiresAt || 0);
  return expiresAt > 0 && expiresAt <= now;
}

function pruneExpiredGrants(now = Date.now()) {
  let removed = 0;
  for (const [key, grant] of grants.entries()) {
    if (!isGrantExpired(grant, now)) continue;
    grants.delete(key);
    removed += 1;
  }
  return removed;
}

function pruneExpiredGrantsAndRefresh(reason = 'grant_expired') {
  const removed = pruneExpiredGrants();
  if (!removed) return 0;
  refreshAllSocketGrantCaches();
  roverManager.broadcastRoster();
  requestEvents.emit('change', { reason, expiredGrants: removed });
  return removed;
}

function listPendingForRequester(socket) {
  const requesterKey = buildRequesterKey(socket);
  const identity = getIdentitySummary(socket);
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

function listGrantedRoversForRequester(requesterKey) {
  pruneExpiredGrants();
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

function refreshAllSocketGrantCaches() {
  io.sockets.sockets.forEach((socket) => applySocketGrantCache(socket));
}

function getGrantForRequester(requesterKey, roverId) {
  if (!requesterKey || !roverId) return null;
  const grantKey = buildGrantKey(requesterKey, roverId);
  const grant = grants.get(grantKey) || null;
  if (!grant) return null;
  if (isGrantExpired(grant)) {
    grants.delete(grantKey);
    return null;
  }
  return grant;
}

function hasClosedPrivateAccessForSocket(socket, roverId) {
  if (!socket || !roverId) return false;
  return Boolean(getGrantForRequester(buildRequesterKey(socket), roverId));
}

function getStateForSocket(socket) {
  pruneExpiredGrants();
  const requesterKey = buildRequesterKey(socket);
  const grantedRovers = [];
  for (const grant of grants.values()) {
    if (grant.requesterKey !== requesterKey) continue;
    grantedRovers.push({
      roverId: grant.roverId,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt || null,
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

function tryAssignClosedPrivateRover(socket, roverId) {
  if (!socket || !roverId) return false;
  const record = roverManager.rovers.get(String(roverId));
  if (!record) return false;
  const access = roverManager.canRequestControl(roverId, socket, {
    allowUser: true,
    allowClosedPrivateGrantInLockdown: true,
  });
  if (!access.ok) {
    throw new Error(access.reason || 'Control denied');
  }
  const previousJoined = roverManager.getRoversForSocket(socket.id);
  roverManager.requestControl(roverId, socket, {
    allowUser: true,
    allowClosedPrivateGrantInLockdown: true,
    forceTurn: true,
  });
  previousJoined.forEach((rid) => {
    if (rid !== roverId) roverManager.releaseControl(rid, socket);
  });
  roverManager.managerEvents.emit('switch', { socketId: socket.id, roverId: String(roverId) });
  try {
    const assignmentService = require('../assignmentService');
    assignmentService.moveAssignment(socket, String(roverId), { releasePrevious: false });
  } catch (err) {
    logger.warn('Failed to move assignment after private access grant', { socketId: socket.id, error: err.message });
  }
  socket.emit('controlGranted', { roverId: String(roverId) });
  roverManager.broadcastRoster();
  return true;
}

function approveRequest(requestId, actorDiscordId = null) {
  const request = findPendingRequestById(requestId);
  if (!request) throw new Error('Request not found or already resolved.');

  request.status = 'approved';
  request.resolvedAt = Date.now();
  request.resolvedBy = actorDiscordId ? String(actorDiscordId) : null;
  pendingByRequesterRover.delete(`${request.requesterKey}:${request.roverId}`);

  const grantKey = buildGrantKey(request.requesterKey, request.roverId);
  const grantedAt = Date.now();
  grants.set(grantKey, {
    requesterKey: request.requesterKey,
    roverId: request.roverId,
    requestId: request.id,
    grantedAt,
    expiresAt: grantedAt + GRANT_TTL_MS,
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
      grantExpiresAt: grantedAt + GRANT_TTL_MS,
      assignedSocketId,
    },
  });
  requestEvents.emit('change', { reason: 'approved', requestId: request.id, roverId: request.roverId, socketId: assignedSocketId });
  return { request, assignedSocketId };
}

function denyRequest(requestId, actorDiscordId = null) {
  const request = findPendingRequestById(requestId);
  if (!request) throw new Error('Request not found or already resolved.');

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
  requestEvents.emit('change', { reason: 'denied', requestId: request.id, roverId: request.roverId });
  return { request };
}

function createRequest(socket, roverIdRaw) {
  if (!socket?.id) throw new Error('Socket required');

  const roverId = normalizeRoverId(roverIdRaw);
  if (!roverId) throw new Error('roverId required');

  const record = roverManager.rovers.get(roverId);
  if (!record) throw new Error('Unknown rover');
  if (!record?.private?.enabled) throw new Error('Rover is not private');
  if (record.privateOpen) throw new Error('Private rover is already open');
  if (isLockdownAdmin(socket)) throw new Error('Lockdown admins can open private rovers directly');

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
      userId: identity.userId || null,
      cookieUserId: normalizeCookieUserId(socket?.data?.cookieUserId) || null,
      fingerprintId: identity.fingerprintId || null,
      ip: normalizeIp(getSocketIp(socket)) || null,
    },
  };

  pendingRequests.set(request.id, request);
  pendingByRequesterRover.set(dedupeKey, request.id);
  lastRequestAtByRequester.set(requesterKey, now);

  publishEvent({ source: 'privateRoverAccessRequest', type: 'privateRoverAccess.requested', payload: request });
  requestEvents.emit('change', { reason: 'created', requestId: request.id, roverId: request.roverId, socketId: socket.id });
  logger.info('Private rover access requested', { requestId: request.id, roverId: request.roverId, socketId: socket.id });

  return { request, isNew: true };
}

module.exports = {
  getStateForSocket,
  createRequest,
  hasClosedPrivateAccessForSocket,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
  applySocketGrantCache,
  refreshAllSocketGrantCaches,
  pruneExpiredGrantsAndRefresh,
  clearPendingForRover,
};
