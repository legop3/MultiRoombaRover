const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('verificationService');
const { publishEvent } = require('./eventBus');
const { getSocketIp, normalizeIp } = require('../helpers/ipResolver');
const { getNickname, setNickname } = require('./nicknameService');
const { getRole } = require('./roleService');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'verified-users.json');
const COOKIE_USER_ID_RE = /^cu_[a-f0-9]{32}$/;

const verificationEvents = new EventEmitter();

let cache = null;

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\*/g, 'nope').slice(0, 32);
}

function normalizeStoreShape(store) {
  const next = store && typeof store === 'object' ? store : {};
  return {
    verifiedUsers: Array.isArray(next.verifiedUsers) ? next.verifiedUsers : [],
    pendingRequests: Array.isArray(next.pendingRequests) ? next.pendingRequests : [],
    dmMessages: Array.isArray(next.dmMessages) ? next.dmMessages : [],
  };
}

function loadStore() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    cache = normalizeStoreShape(JSON.parse(raw));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load verification store', err.message);
    }
    cache = normalizeStoreShape({});
  }
  return cache;
}

function writeStore(next) {
  const normalized = normalizeStoreShape(next);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, STORE_PATH);
  cache = normalized;
  return cache;
}

function withStore(mutator) {
  const current = loadStore();
  const draft = {
    verifiedUsers: current.verifiedUsers.map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] })),
    pendingRequests: current.pendingRequests.map((entry) => ({ ...entry })),
    dmMessages: current.dmMessages.map((entry) => ({ ...entry })),
  };
  const result = mutator(draft);
  writeStore(draft);
  return result;
}

function generateCookieUserId() {
  return `cu_${crypto.randomBytes(16).toString('hex')}`;
}

function normalizeCookieUserId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.toLowerCase();
}

function isValidCookieUserId(value) {
  return COOKIE_USER_ID_RE.test(normalizeCookieUserId(value));
}

function getKnownIp(socket) {
  return normalizeIp(getSocketIp(socket));
}

function ensureSocketData(socket) {
  socket.data = socket.data || {};
  return socket.data;
}

function findVerifiedMatch(store, { cookieUserId, ip }) {
  if (!cookieUserId && !ip) return null;
  const byCookie = cookieUserId
    ? store.verifiedUsers.find((entry) => normalizeCookieUserId(entry.cookieUserId) === cookieUserId) || null
    : null;
  if (byCookie) return byCookie;
  if (!ip) return null;
  return (
    store.verifiedUsers.find((entry) => Array.isArray(entry.knownIps) && entry.knownIps.includes(ip)) || null
  );
}

function emitChange(reason, payload = {}) {
  verificationEvents.emit('change', { reason, ...payload });
}

function reevaluateSocketVerification(socket) {
  if (!socket) return { isVerified: false, matchedRecordId: null, reason: 'missing_socket' };
  const store = loadStore();
  const data = ensureSocketData(socket);
  const role = getRole(socket);
  const cookieUserId = normalizeCookieUserId(data.cookieUserId);
  const nickname = sanitizeNickname(getNickname(socket));
  const ip = getKnownIp(socket);

  if (role === 'lockdown') {
    data.isVerified = true;
    data.verifiedRecordId = null;
    return {
      isVerified: true,
      matchedRecordId: null,
      reason: 'lockdown_admin',
      cookieUserId,
      nickname,
      ip,
    };
  }

  const match = findVerifiedMatch(store, { cookieUserId, ip });
  const nicknameMatches = Boolean(match && nickname && sanitizeNickname(match.nickname) === nickname);

  let isVerified = false;
  let reason = 'no_match';
  if (match && nicknameMatches) {
    isVerified = true;
    reason = 'matched';
  } else if (match && !nicknameMatches) {
    reason = 'nickname_mismatch';
  }

  data.isVerified = isVerified;
  data.verifiedRecordId = isVerified ? match.id : null;

  if (isVerified) {
    withStore((draft) => {
      const record = draft.verifiedUsers.find((entry) => entry.id === match.id);
      if (!record) return;
      record.updatedAt = Date.now();
      record.nickname = nickname;
      if (ip && !record.knownIps.includes(ip)) {
        record.knownIps.push(ip);
      }
    });
  }

  return {
    isVerified,
    matchedRecordId: isVerified ? match.id : null,
    reason,
    cookieUserId,
    nickname,
    ip,
  };
}

function identifySocket(socket, payload = {}) {
  if (!socket) {
    throw new Error('Socket required');
  }
  const data = ensureSocketData(socket);
  const incomingKey = normalizeCookieUserId(payload.cookieUserId);
  if (incomingKey && !isValidCookieUserId(incomingKey)) {
    throw new Error('Invalid identity key format.');
  }
  const currentKey = normalizeCookieUserId(data.cookieUserId);
  const safeCurrentKey = isValidCookieUserId(currentKey) ? currentKey : '';
  data.cookieUserId = incomingKey || safeCurrentKey || generateCookieUserId();

  const incomingNickname = sanitizeNickname(payload.nickname);
  if (incomingNickname) {
    try {
      if (incomingNickname !== getNickname(socket)) {
        setNickname(socket, incomingNickname);
      }
    } catch (err) {
      logger.warn('Failed to set nickname from identify', err.message);
    }
  }

  const verification = reevaluateSocketVerification(socket);
  emitChange('identify', { socketId: socket.id });
  return {
    cookieUserId: data.cookieUserId,
    isVerified: verification.isVerified,
    reason: verification.reason,
    identifiedAt: Date.now(),
  };
}

function getVerificationStatus(socket) {
  const data = socket?.data || {};
  return {
    isVerified: Boolean(data.isVerified),
    recordId: data.verifiedRecordId || null,
  };
}

function getIdentitySummary(socket) {
  const data = socket?.data || {};
  return {
    cookieUserId: normalizeCookieUserId(data.cookieUserId) || null,
    nickname: getNickname(socket) || null,
  };
}

function getPendingRequestForIdentity(cookieUserId) {
  const key = normalizeCookieUserId(cookieUserId);
  if (!key) return null;
  const store = loadStore();
  return store.pendingRequests.find((entry) => entry.status === 'pending' && entry.cookieUserId === key) || null;
}

function listVerifiedUsers() {
  const store = loadStore();
  return store.verifiedUsers.map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] }));
}

function resolveVerifiedUserSelector(selector) {
  const value = String(selector || '').trim();
  if (!value) return { error: 'selector_required' };
  const store = loadStore();
  const byCookie = store.verifiedUsers.find((entry) => entry.cookieUserId === value) || null;
  if (byCookie) return { record: byCookie };
  const byNickname = store.verifiedUsers.filter((entry) => sanitizeNickname(entry.nickname) === sanitizeNickname(value));
  if (byNickname.length === 1) return { record: byNickname[0] };
  if (byNickname.length > 1) return { error: 'ambiguous_nickname' };
  return { error: 'not_found' };
}

function removeVerifiedUser(selector, removedBy = null) {
  const resolved = resolveVerifiedUserSelector(selector);
  if (resolved.error) {
    throw new Error(
      resolved.error === 'ambiguous_nickname'
        ? 'Nickname matches multiple users; remove by cookieUserId.'
        : 'Verified user not found.',
    );
  }
  const target = resolved.record;
  let removed = null;
  withStore((draft) => {
    const before = draft.verifiedUsers.length;
    draft.verifiedUsers = draft.verifiedUsers.filter((entry) => entry.id !== target.id);
    if (draft.verifiedUsers.length !== before) {
      removed = target;
    }
  });
  if (!removed) {
    throw new Error('Verified user not found.');
  }

  io.sockets.sockets.forEach((socket) => {
    const data = ensureSocketData(socket);
    if (normalizeCookieUserId(data.cookieUserId) === removed.cookieUserId) {
      reevaluateSocketVerification(socket);
    }
  });

  emitChange('remove', { cookieUserId: removed.cookieUserId });
  publishEvent({
    source: 'verification',
    type: 'verification.userRemoved',
    payload: {
      cookieUserId: removed.cookieUserId,
      nickname: removed.nickname,
      removedBy,
      removedAt: Date.now(),
    },
  });

  return removed;
}

function createVerificationRequest(socket) {
  if (!socket) {
    throw new Error('Socket required');
  }
  const data = ensureSocketData(socket);
  const cookieUserId = normalizeCookieUserId(data.cookieUserId);
  const nickname = sanitizeNickname(getNickname(socket));
  const ip = getKnownIp(socket);

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

function getVerificationStateForSocket(socket) {
  const identity = getIdentitySummary(socket);
  const pending = getPendingRequestForIdentity(identity.cookieUserId);
  return {
    isVerified: Boolean(socket?.data?.isVerified),
    pendingRequestId: pending?.id || null,
    pendingRequestedAt: pending?.createdAt || null,
  };
}

function isVerified(socket) {
  return Boolean(socket?.data?.isVerified);
}

io.on('connection', (socket) => {
  identifySocket(socket, {});

  socket.on('session:identify', (payload = {}, cb = () => {}) => {
    try {
      const result = identifySocket(socket, payload || {});
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

module.exports = {
  identifySocket,
  getVerificationStatus,
  getIdentitySummary,
  getVerificationStateForSocket,
  createVerificationRequest,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
  listVerifiedUsers,
  removeVerifiedUser,
  isVerified,
  reevaluateSocketVerification,
  verificationEvents,
};
