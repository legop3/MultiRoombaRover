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

const pendingRequests = new Map(); // requestId -> request
const pendingByRequesterRover = new Map(); // `${requesterKey}:${roverId}` -> requestId
const lastRequestAtByRequester = new Map(); // requesterKey -> ts

function normalizeRoverId(value) {
  return String(value || '').trim();
}

function buildRequesterKey(socket) {
  const cookieUserId = String(socket?.data?.cookieUserId || '').trim().toLowerCase();
  if (cookieUserId) return `cookie:${cookieUserId}`;
  return `socket:${socket?.id || 'unknown'}`;
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
  return {
    requestableRovers: listClosedPrivateRovers(),
    pendingRequests: listPendingForRequester(socket),
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
  }
  requestEvents.emit('change', {
    reason: 'rover',
    roverId: String(roverId),
    action: action || null,
  });
});

io.on('connection', (socket) => {
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
});

module.exports = {
  requestEvents,
  getStateForSocket,
  createRequest,
};

