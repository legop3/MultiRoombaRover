// Verification Service Module
// Purpose: Binds socket.IO verification/moderation events to the central identity service.
// Scope: Keeps verification workflow behavior stable while moving user equality to identityService.
const EventEmitter = require('events');
const crypto = require('crypto');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('verificationService');
const { publishEvent } = require('../eventBus');
const { getNickname, setNickname } = require('../nicknameService');
const { getRole, roleEvents } = require('../roleService');
const {
  getDb,
  identifySocket: identifyCanonicalSocket,
  getUserById,
  getUserForSocket,
  getUserIdForSocket,
  getIdentitySummary,
  getKnownIp,
  normalizeCookieUserId,
  isValidCookieUserId,
  normalizeFingerprintId,
  isValidFingerprintId,
  resolveUserIdForIdentity,
  attachIdentitySignals,
  sanitizeNickname,
  setVerified,
  setDeterrence,
  listVerifiedUsers,
  listDeterredUsers,
  resolveUserBySelector,
  userToLegacyIdentityEntry,
} = require('../identityService');

const verificationEvents = new EventEmitter();
const IDENTITY_TIMEOUT_MS = 2 * 60 * 1000;
const IDENTITY_SWEEP_INTERVAL_MS = 15 * 1000;
const DUPLICATE_IDENTITY_DISCONNECT_DELAY_MS = 250;

function emitChange(reason, payload = {}) {
  verificationEvents.emit('change', { reason, ...payload });
}

function isAdminRole(role) {
  return role === 'admin' || role === 'lockdown' || role === 'lockdown-admin';
}

function refreshSocketIdentityFlags(socket) {
  const user = getUserForSocket(socket);
  if (!socket?.data || !user) {
    return { isVerified: false, isDeterred: false, matchedRecordId: null, reason: 'no_user' };
  }

  const role = getRole(socket);
  const verifiedByRole = isAdminRole(role);
  const deterredByUser = Boolean(user.deterrence?.enabled);
  socket.data.isVerified = verifiedByRole || Boolean(user.verified?.enabled);
  socket.data.verifiedRecordId = socket.data.isVerified ? user.id : null;
  socket.data.isDeterred = isAdminRole(role) ? false : deterredByUser;
  socket.data.deterredRecordId = socket.data.isDeterred ? user.id : null;
  return {
    isVerified: socket.data.isVerified,
    isDeterred: socket.data.isDeterred,
    matchedRecordId: user.id,
    reason: socket.data.isVerified ? 'matched' : 'no_match',
    userId: user.id,
  };
}

function identifySocket(socket, payload = {}) {
  if (!socket) throw new Error('Socket required');

  const incomingNickname = sanitizeNickname(payload.nickname);
  if (incomingNickname) {
    try {
      if (incomingNickname !== getNickname(socket)) {
        setNickname(socket, incomingNickname);
      }
      socket.data = socket.data || {};
      socket.data.nickname = incomingNickname;
    } catch (err) {
      logger.warn('Failed to set nickname from identify', err.message);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'overseerEnabled')) {
    socket.data = socket.data || {};
    socket.data.overseerEnabled = Boolean(payload.overseerEnabled);
  } else if (typeof socket?.data?.overseerEnabled !== 'boolean') {
    socket.data = socket.data || {};
    socket.data.overseerEnabled = true;
  }

  /*
    Spectator-style pages send identity heartbeats too, but only the driver
    surface participates in duplicate-driver enforcement. This flag remains on
    the socket because it is connection-specific, not person-specific.
  */
  socket.data.identitySurface = payload.identitySurface === 'driver' ? 'driver' : 'passive';

  const result = identifyCanonicalSocket(socket, {
    ...payload,
    nickname: incomingNickname || getNickname(socket) || '',
  });
  refreshSocketIdentityFlags(socket);
  enforceSingleUnverifiedSocketPerIdentity(socket);
  emitChange('identify', { socketId: socket.id, userId: result.userId });

  return {
    cookieUserId: result.cookieUserId,
    fingerprintId: result.fingerprintId,
    userId: result.userId,
    overseerEnabled: Boolean(socket.data.overseerEnabled),
    isVerified: Boolean(socket.data.isVerified),
    isDeterred: Boolean(socket.data.isDeterred),
    reason: socket.data.isVerified ? 'matched' : 'no_match',
    identifiedAt: Date.now(),
  };
}

function emitDuplicateIdentityAndDisconnect(socket, payload = {}) {
  if (!socket?.id || socket.disconnected) return;
  socket.emit('session:duplicateIdentity', {
    reason: 'duplicate_identity',
    message: 'This driver session is already active in another tab.',
    ...payload,
  });
  setTimeout(() => {
    if (!socket.disconnected) {
      socket.disconnect(true);
    }
  }, DUPLICATE_IDENTITY_DISCONNECT_DELAY_MS);
}

function enforceSingleUnverifiedSocketPerIdentity(currentSocket) {
  const currentUserId = getUserIdForSocket(currentSocket);
  if (
    !currentSocket?.id ||
    !currentUserId ||
    currentSocket.data?.isVerified ||
    currentSocket.data?.identitySurface !== 'driver'
  ) {
    return;
  }

  const duplicates = Array.from(io.sockets.sockets.values()).filter((candidate) => {
    if (!candidate?.id || candidate.id === currentSocket.id || candidate.disconnected) return false;
    if (candidate?.data?.identitySurface !== 'driver') return false;
    return getUserIdForSocket(candidate) === currentUserId;
  });

  if (!duplicates.length) return;
  const verifiedDuplicate = duplicates.find((candidate) => candidate?.data?.isVerified);
  if (verifiedDuplicate) {
    logger.info('Disconnecting non-verified socket because its user is already active on a verified socket', {
      socketId: currentSocket.id,
      retainedSocketId: verifiedDuplicate.id,
      userId: currentUserId,
    });
    emitDuplicateIdentityAndDisconnect(currentSocket, { retainedSocketId: verifiedDuplicate.id });
    return;
  }

  duplicates.forEach((duplicate) => {
    logger.info('Disconnecting older non-verified duplicate user socket', {
      socketId: duplicate.id,
      retainedSocketId: currentSocket.id,
      userId: currentUserId,
    });
    emitDuplicateIdentityAndDisconnect(duplicate, { retainedSocketId: currentSocket.id });
  });
}

function getPendingRequestForUser(userId) {
  if (!userId) return null;
  return getDb().prepare(`
    select * from verification_requests
    where user_id = ? and status = 'pending'
    order by created_at desc
    limit 1
  `).get(userId) || null;
}

function getVerificationStateForSocket(socket) {
  const userId = getUserIdForSocket(socket);
  const pending = getPendingRequestForUser(userId);
  return {
    isVerified: Boolean(socket?.data?.isVerified),
    pendingRequestId: pending?.id || null,
    pendingRequestedAt: pending?.created_at || null,
  };
}

function getModerationStateForSocket(socket) {
  return {
    isDeterred: Boolean(socket?.data?.isDeterred),
    recordId: socket?.data?.deterredRecordId || null,
  };
}

function createVerificationRequest(socket) {
  if (!socket) throw new Error('Socket required');
  refreshSocketIdentityFlags(socket);
  const user = getUserForSocket(socket);
  if (!user) throw new Error('Identity missing. Reconnect and try again.');
  if (socket.data?.isVerified) throw new Error('You are already verified.');

  const cookieUserId = normalizeCookieUserId(socket.data?.cookieUserId);
  if (!cookieUserId || !isValidCookieUserId(cookieUserId)) {
    throw new Error('Identity key format invalid.');
  }

  const existingPending = getPendingRequestForUser(user.id);
  if (existingPending) {
    return {
      id: existingPending.id,
      status: existingPending.status,
      cookieUserId: existingPending.cookie_user_id,
      userId: existingPending.user_id,
    };
  }

  const request = {
    id: `vr_${crypto.randomBytes(8).toString('hex')}`,
    status: 'pending',
    userId: user.id,
    cookieUserId,
    fingerprintId: normalizeFingerprintId(socket.data?.fingerprintId) || null,
    nickname: getNickname(socket) || user.nickname || null,
    ip: getKnownIp(socket) || null,
    socketId: socket.id,
    createdAt: Date.now(),
  };

  getDb().prepare(`
    insert into verification_requests
      (id, user_id, cookie_user_id, fingerprint_id, nickname, ip, socket_id, status, decision, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    request.id,
    request.userId,
    request.cookieUserId,
    request.fingerprintId,
    request.nickname,
    request.ip,
    request.socketId,
    request.status,
    null,
    request.createdAt,
  );

  publishEvent({ source: 'verification', type: 'verification.requested', payload: request });
  emitChange('request', { requestId: request.id, socketId: socket.id, userId: user.id });
  return request;
}

function attachDmMessage(requestId, messageId, adminDiscordId) {
  if (!requestId || !messageId) return;
  getDb().prepare(`
    insert or ignore into verification_dm_messages (message_id, request_id, admin_discord_id, created_at)
    values (?, ?, ?, ?)
  `).run(String(messageId), String(requestId), adminDiscordId ? String(adminDiscordId) : null, Date.now());
}

function rowToRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    cookieUserId: row.cookie_user_id,
    fingerprintId: row.fingerprint_id,
    nickname: row.nickname,
    ip: row.ip,
    socketId: row.socket_id,
    status: row.status,
    decision: row.decision,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

function getPendingRequestById(requestId) {
  if (!requestId) return null;
  return rowToRequest(getDb().prepare(`
    select * from verification_requests
    where id = ? and status = 'pending'
  `).get(String(requestId)));
}

function getRequestByMessageId(messageId) {
  if (!messageId) return null;
  const map = getDb().prepare('select * from verification_dm_messages where message_id = ?').get(String(messageId));
  if (!map) return null;
  const request = rowToRequest(getDb().prepare('select * from verification_requests where id = ?').get(map.request_id));
  return request ? {
    request,
    map: {
      requestId: map.request_id,
      messageId: map.message_id,
      adminDiscordId: map.admin_discord_id,
      createdAt: map.created_at,
    },
  } : null;
}

function refreshSocketsForUser(userId) {
  io.sockets.sockets.forEach((socket) => {
    if (getUserIdForSocket(socket) !== userId) return;
    refreshSocketIdentityFlags(socket);
    emitChange('user_refresh', { socketId: socket.id, userId });
  });
}

function approveRequest(requestId, actorDiscordId) {
  const request = getPendingRequestById(requestId);
  if (!request) throw new Error('Request not found or already resolved.');
  const resolvedAt = Date.now();
  const actor = actorDiscordId ? String(actorDiscordId) : null;

  getDb().prepare(`
    update verification_requests
    set status = 'approved', decision = 'approved', resolved_at = ?, resolved_by = ?
    where id = ? and status = 'pending'
  `).run(resolvedAt, actor, requestId);

  setVerified(request.userId, { enabled: true, actor, at: resolvedAt });
  refreshSocketsForUser(request.userId);

  publishEvent({
    source: 'verification',
    type: 'verification.resolved',
    payload: {
      requestId,
      decision: 'approved',
      userId: request.userId,
      cookieUserId: request.cookieUserId,
      nickname: request.nickname,
      resolvedBy: actor,
      resolvedAt,
    },
  });
  emitChange('approve', { requestId, userId: request.userId });
}

function denyRequest(requestId, actorDiscordId) {
  const request = getPendingRequestById(requestId);
  if (!request) throw new Error('Request not found or already resolved.');
  const resolvedAt = Date.now();
  const actor = actorDiscordId ? String(actorDiscordId) : null;
  getDb().prepare(`
    update verification_requests
    set status = 'denied', decision = 'denied', resolved_at = ?, resolved_by = ?
    where id = ? and status = 'pending'
  `).run(resolvedAt, actor, requestId);

  publishEvent({
    source: 'verification',
    type: 'verification.resolved',
    payload: {
      requestId,
      decision: 'denied',
      userId: request.userId,
      cookieUserId: request.cookieUserId,
      nickname: request.nickname,
      resolvedBy: actor,
      resolvedAt,
    },
  });
  emitChange('deny', { requestId, userId: request.userId });
}

function removeVerifiedUser(selector, removedBy = null) {
  const resolved = resolveUserBySelector(selector, { includeVerified: true, includeDeterred: false });
  if (resolved.error || !resolved.user) {
    throw new Error(resolved.error === 'ambiguous_nickname' ? 'Nickname matches multiple users.' : 'Verified user not found.');
  }
  const removed = setVerified(resolved.user.id, { enabled: false, actor: removedBy || null });
  refreshSocketsForUser(resolved.user.id);
  emitChange('remove', { userId: resolved.user.id });
  publishEvent({
    source: 'verification',
    type: 'verification.userRemoved',
    payload: {
      userId: removed.id,
      cookieUserId: removed.cookieUserIds[0] || null,
      nickname: removed.nickname,
      removedBy,
      removedAt: Date.now(),
    },
  });
  return userToLegacyIdentityEntry(removed);
}

function deterUser(selector, options = {}) {
  const rawSelector = String(selector || '').trim();
  if (!rawSelector) throw new Error('Selector required.');
  let resolved = resolveUserBySelector(rawSelector, { includeVerified: true, includeDeterred: true });

  if (resolved.error === 'not_found') {
    const cookie = normalizeCookieUserId(rawSelector);
    const fingerprint = normalizeFingerprintId(rawSelector);
    if (cookie && isValidCookieUserId(cookie)) {
      const userId = resolveUserIdForIdentity({ cookieUserId: cookie }, { create: true });
      resolved = { user: attachIdentitySignals(userId, { cookieUserId: cookie }) };
    } else if (fingerprint && isValidFingerprintId(fingerprint)) {
      const userId = resolveUserIdForIdentity({ fingerprintId: fingerprint }, { create: true });
      resolved = { user: attachIdentitySignals(userId, { fingerprintId: fingerprint }) };
    }
  }

  if (resolved.error || !resolved.user) {
    throw new Error(resolved.error === 'ambiguous_nickname' ? 'Nickname matches multiple users.' : 'User not found.');
  }

  const wasDeterred = Boolean(resolved.user.deterrence?.enabled);
  const user = setDeterrence(resolved.user.id, {
    enabled: true,
    reason: String(options?.reason || '').trim() || null,
    actor: options?.actor ? String(options.actor) : null,
    at: Date.now(),
  });
  refreshSocketsForUser(user.id);
  publishEvent({
    source: 'moderation',
    type: wasDeterred ? 'moderation.deterrenceUpdated' : 'moderation.deterred',
    payload: {
      id: user.id,
      userId: user.id,
      cookieUserId: user.cookieUserIds[0] || null,
      fingerprintId: user.fingerprintIds[0] || null,
      nickname: user.nickname,
      knownIps: user.knownIps,
      reason: user.deterrence.reason,
      actor: options?.actor ? String(options.actor) : null,
      ts: Date.now(),
    },
  });
  emitChange('deter_update', { userId: user.id });
  return { ...userToLegacyIdentityEntry(user), created: !wasDeterred };
}

function undeterUser(selector, removedBy = null) {
  const resolved = resolveUserBySelector(selector, { includeVerified: true, includeDeterred: true });
  if (resolved.error || !resolved.user || !resolved.user.deterrence?.enabled) {
    throw new Error(resolved.error === 'ambiguous_nickname' ? 'Nickname matches multiple users.' : 'Deterred user not found.');
  }
  const user = setDeterrence(resolved.user.id, { enabled: false, actor: removedBy || null });
  refreshSocketsForUser(user.id);
  const removedAt = Date.now();
  emitChange('deter_remove', { userId: user.id });
  publishEvent({
    source: 'moderation',
    type: 'moderation.undeterred',
    payload: {
      id: user.id,
      userId: user.id,
      cookieUserId: user.cookieUserIds[0] || null,
      nickname: user.nickname,
      removedBy: removedBy ? String(removedBy) : null,
      removedAt,
    },
  });
  return userToLegacyIdentityEntry(user);
}

function reevaluateSocketVerification(socket) {
  return refreshSocketIdentityFlags(socket);
}

function reevaluateSocketDeterrence(socket) {
  return refreshSocketIdentityFlags(socket);
}

function getVerificationStatus(socket) {
  return {
    isVerified: Boolean(socket?.data?.isVerified),
    recordId: socket?.data?.verifiedRecordId || null,
  };
}

io.on('connection', (socket) => {
  socket.data = socket.data || {};
  socket.data.connectedAt = Date.now();
  identifySocket(socket, {});

  socket.on('session:identify', (payload = {}, cb = () => {}) => {
    try {
      const result = identifySocket(socket, payload || {});
      socket.data.lastClientIdentifyAt = Date.now();
      cb({ success: true, ...result });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('verification:request', (_, cb = () => {}) => {
    try {
      const request = createVerificationRequest(socket);
      cb({ success: true, requestId: request.id, status: request.status });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

roleEvents.on('change', ({ socket }) => {
  if (!socket) return;
  try {
    refreshSocketIdentityFlags(socket);
    emitChange('role_change', { socketId: socket.id, userId: getUserIdForSocket(socket) });
  } catch (err) {
    logger.warn('Failed to reevaluate verification on role change', err.message);
  }
});

setInterval(() => {
  const now = Date.now();
  io.sockets.sockets.forEach((socket) => {
    if (!socket?.id) return;
    const role = getRole(socket);
    if (role === 'admin' || role === 'lockdown' || role === 'spectator') return;
    const connectedAt = Number(socket?.data?.connectedAt || 0);
    const lastClientIdentifyAt = Number(socket?.data?.lastClientIdentifyAt || 0);
    const referenceTs = lastClientIdentifyAt || connectedAt;
    if (!referenceTs) return;
    if (now - referenceTs < IDENTITY_TIMEOUT_MS) return;
    logger.info('Disconnecting socket due to stale identity heartbeat', {
      socketId: socket.id,
      role,
      ageMs: now - referenceTs,
      hadClientIdentify: Boolean(lastClientIdentifyAt),
    });
    socket.disconnect(true);
  });
}, IDENTITY_SWEEP_INTERVAL_MS);

module.exports = {
  identifySocket,
  getVerificationStatus,
  getIdentitySummary,
  getVerificationStateForSocket,
  getModerationStateForSocket,
  createVerificationRequest,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
  listVerifiedUsers,
  removeVerifiedUser,
  listDeterredUsers,
  deterUser,
  undeterUser,
  isVerified: (socket) => Boolean(socket?.data?.isVerified),
  isDeterred: (socket) => Boolean(socket?.data?.isDeterred),
  reevaluateSocketVerification,
  reevaluateSocketDeterrence,
  verificationEvents,
};
