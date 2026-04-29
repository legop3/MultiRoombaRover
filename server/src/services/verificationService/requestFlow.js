// Verification Request Flow Module
// Purpose: Handles verification request creation, mapping, and approve/deny lifecycle transitions.
// Scope: Owns pending request records and the side effects that update connected sockets and event streams.
const crypto = require('crypto');

function createRequestFlow(deps) {
  const {
    loadStore,
    withStore,
    io,
    publishEvent,
    emitChange,
    ensureSocketData,
    identityFromSocket,
    isValidCookieUserId,
    normalizeCookieUserId,
    reevaluateSocketVerification,
    reevaluateSocketDeterrence,
  } = deps;

  function getPendingRequestForIdentity(cookieUserId) {
    const key = normalizeCookieUserId(cookieUserId);
    if (!key) return null;
    const store = loadStore();
    return store.pendingRequests.find((entry) => entry.status === 'pending' && entry.cookieUserId === key) || null;
  }

  function createVerificationRequest(socket) {
    if (!socket) {
      throw new Error('Socket required');
    }
    const data = ensureSocketData(socket);
    const { cookieUserId, nickname, ip } = identityFromSocket(socket);

    if (data.isVerified) {
      throw new Error('You are already verified.');
    }
    if (!cookieUserId) {
      throw new Error('Identity key missing. Reconnect and try again.');
    }
    if (!isValidCookieUserId(cookieUserId)) {
      throw new Error('Identity key format invalid.');
    }
    if (!nickname) {
      throw new Error('Nickname required before requesting verification.');
    }

    const existingPending = getPendingRequestForIdentity(cookieUserId);
    if (existingPending) {
      return existingPending;
    }

    const request = {
      id: `vr_${crypto.randomBytes(8).toString('hex')}`,
      status: 'pending',
      cookieUserId,
      nickname,
      ip,
      socketId: socket.id,
      createdAt: Date.now(),
      resolvedAt: null,
      resolvedBy: null,
      decision: null,
    };

    withStore((draft) => {
      draft.pendingRequests.push(request);
    });

    publishEvent({ source: 'verification', type: 'verification.requested', payload: request });
    emitChange('request', { requestId: request.id, socketId: socket.id });
    return request;
  }

  function attachDmMessage(requestId, messageId, adminDiscordId) {
    if (!requestId || !messageId) return;
    withStore((draft) => {
      const exists = draft.dmMessages.find((entry) => entry.messageId === messageId);
      if (exists) return;
      draft.dmMessages.push({
        requestId,
        messageId,
        adminDiscordId: adminDiscordId ? String(adminDiscordId) : null,
        createdAt: Date.now(),
      });
    });
  }

  function getPendingRequestById(requestId) {
    if (!requestId) return null;
    const store = loadStore();
    return store.pendingRequests.find((entry) => entry.id === requestId && entry.status === 'pending') || null;
  }

  function getRequestByMessageId(messageId) {
    if (!messageId) return null;
    const store = loadStore();
    const map = store.dmMessages.find((entry) => entry.messageId === messageId);
    if (!map) return null;
    const request = store.pendingRequests.find((entry) => entry.id === map.requestId) || null;
    return request ? { request, map } : null;
  }

  function approveRequest(requestId, actorDiscordId) {
    const request = getPendingRequestById(requestId);
    if (!request) {
      throw new Error('Request not found or already resolved.');
    }

    const approvedAt = Date.now();
    const actor = actorDiscordId ? String(actorDiscordId) : null;

    withStore((draft) => {
      const pending = draft.pendingRequests.find((entry) => entry.id === requestId);
      if (!pending || pending.status !== 'pending') {
        throw new Error('Request not found or already resolved.');
      }
      pending.status = 'approved';
      pending.decision = 'approved';
      pending.resolvedAt = approvedAt;
      pending.resolvedBy = actor;

      let target =
        draft.verifiedUsers.find((entry) => entry.cookieUserId === pending.cookieUserId) ||
        draft.verifiedUsers.find((entry) => Array.isArray(entry.knownIps) && entry.knownIps.includes(pending.ip));

      if (!target) {
        target = {
          id: `vu_${crypto.randomBytes(8).toString('hex')}`,
          cookieUserId: pending.cookieUserId,
          nickname: pending.nickname,
          knownIps: pending.ip ? [pending.ip] : [],
          createdAt: approvedAt,
          updatedAt: approvedAt,
          approvedBy: actor,
        };
        draft.verifiedUsers.push(target);
      } else {
        target.cookieUserId = pending.cookieUserId;
        target.nickname = pending.nickname;
        if (pending.ip && !target.knownIps.includes(pending.ip)) {
          target.knownIps.push(pending.ip);
        }
        target.updatedAt = approvedAt;
        target.approvedBy = actor;
      }
    });

    io.sockets.sockets.forEach((socket) => {
      const data = ensureSocketData(socket);
      if (normalizeCookieUserId(data.cookieUserId) === request.cookieUserId) {
        reevaluateSocketVerification(socket);
        reevaluateSocketDeterrence(socket);
      }
    });

    publishEvent({
      source: 'verification',
      type: 'verification.resolved',
      payload: {
        requestId,
        decision: 'approved',
        cookieUserId: request.cookieUserId,
        nickname: request.nickname,
        resolvedBy: actor,
        resolvedAt: approvedAt,
      },
    });
    emitChange('approve', { requestId });
  }

  function denyRequest(requestId, actorDiscordId) {
    const request = getPendingRequestById(requestId);
    if (!request) {
      throw new Error('Request not found or already resolved.');
    }

    const deniedAt = Date.now();
    const actor = actorDiscordId ? String(actorDiscordId) : null;

    withStore((draft) => {
      const pending = draft.pendingRequests.find((entry) => entry.id === requestId);
      if (!pending || pending.status !== 'pending') {
        throw new Error('Request not found or already resolved.');
      }
      pending.status = 'denied';
      pending.decision = 'denied';
      pending.resolvedAt = deniedAt;
      pending.resolvedBy = actor;
    });

    publishEvent({
      source: 'verification',
      type: 'verification.resolved',
      payload: {
        requestId,
        decision: 'denied',
        cookieUserId: request.cookieUserId,
        nickname: request.nickname,
        resolvedBy: actor,
        resolvedAt: deniedAt,
      },
    });
    emitChange('deny', { requestId });
  }

  return {
    getPendingRequestForIdentity,
    createVerificationRequest,
    attachDmMessage,
    getRequestByMessageId,
    approveRequest,
    denyRequest,
  };
}

module.exports = {
  createRequestFlow,
};
