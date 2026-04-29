// verification Service
// Purpose: Defines the verification Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('verificationService');
const { publishEvent } = require('../eventBus');
const { normalizeIp } = require('../../helpers/ipResolver');
const { getNickname, setNickname } = require('../nicknameService');
const { getRole, roleEvents } = require('../roleService');
const {
  sanitizeNickname,
  normalizeCookieUserId,
  isValidCookieUserId,
  generateCookieUserId,
  getKnownIp,
  createJsonStore,
} = require('../identityService');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'verified-users.json');

const verificationEvents = new EventEmitter();

function normalizeStoreShape(store) {
  const next = store && typeof store === 'object' ? store : {};
  return {
    verifiedUsers: Array.isArray(next.verifiedUsers) ? next.verifiedUsers : [],
    pendingRequests: Array.isArray(next.pendingRequests) ? next.pendingRequests : [],
    dmMessages: Array.isArray(next.dmMessages) ? next.dmMessages : [],
    deterredUsers: Array.isArray(next.deterredUsers) ? next.deterredUsers : [],
  };
}

function cloneStore(current) {
  return {
    verifiedUsers: (current.verifiedUsers || []).map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] })),
    pendingRequests: (current.pendingRequests || []).map((entry) => ({ ...entry })),
    dmMessages: (current.dmMessages || []).map((entry) => ({ ...entry })),
    deterredUsers: (current.deterredUsers || []).map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] })),
  };
}

const storeApi = createJsonStore({
  path: STORE_PATH,
  normalizeStoreShape,
  cloneStore,
  logger,
});

const { loadStore, withStore } = storeApi;

function ensureSocketData(socket) {
  socket.data = socket.data || {};
  return socket.data;
}

function identityFromSocket(socket) {
  const data = ensureSocketData(socket);
  return {
    cookieUserId: normalizeCookieUserId(data.cookieUserId),
    nickname: sanitizeNickname(getNickname(socket)),
    ip: getKnownIp(socket),
  };
}

function normalizeNicknameKey(value) {
  return sanitizeNickname(value).toLowerCase();
}

function normalizeKnownIps(raw = []) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((value) => {
    const ip = typeof value === 'string' ? value.trim() : '';
    if (!ip) return;
    if (!out.includes(ip)) {
      out.push(ip);
    }
  });
  return out;
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

function isAdminRole(role) {
  return role === 'admin' || role === 'lockdown' || role === 'lockdown-admin';
}

function findDeterredMatch(store, { cookieUserId, nickname, ip }) {
  const nicknameKey = normalizeNicknameKey(nickname);
  return (
    (store.deterredUsers || []).find((entry) => {
      const entryCookie = normalizeCookieUserId(entry.cookieUserId);
      if (cookieUserId && entryCookie && entryCookie === cookieUserId) return true;
      const entryIps = normalizeKnownIps(entry.knownIps);
      if (ip && entryIps.includes(ip)) return true;
      const entryNicknameKey = normalizeNicknameKey(entry.nickname);
      if (nicknameKey && entryNicknameKey && entryNicknameKey === nicknameKey) return true;
      return false;
    }) || null
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
  const { cookieUserId, nickname, ip } = identityFromSocket(socket);

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

function reevaluateSocketDeterrence(socket) {
  if (!socket) return { isDeterred: false, matchedRecordId: null, reason: 'missing_socket' };
  const store = loadStore();
  const data = ensureSocketData(socket);
  const role = getRole(socket);
  const { cookieUserId, nickname, ip } = identityFromSocket(socket);

  if (isAdminRole(role)) {
    data.isDeterred = false;
    data.deterredRecordId = null;
    return {
      isDeterred: false,
      matchedRecordId: null,
      reason: 'admin_bypass',
      cookieUserId,
      nickname,
      ip,
    };
  }

  const match = findDeterredMatch(store, { cookieUserId, nickname, ip });
  const isDeterred = Boolean(match);
  data.isDeterred = isDeterred;
  data.deterredRecordId = isDeterred ? match.id : null;

  if (isDeterred) {
    withStore((draft) => {
      const record = (draft.deterredUsers || []).find((entry) => entry.id === match.id);
      if (!record) return;
      record.updatedAt = Date.now();
      if (cookieUserId) {
        record.cookieUserId = cookieUserId;
      }
      if (nickname) {
        record.nickname = nickname;
      }
      record.knownIps = normalizeKnownIps(record.knownIps);
      if (ip && !record.knownIps.includes(ip)) {
        record.knownIps.push(ip);
      }
    });
  }

  return {
    isDeterred,
    matchedRecordId: isDeterred ? match.id : null,
    reason: isDeterred ? 'matched' : 'no_match',
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
  const deterrence = reevaluateSocketDeterrence(socket);
  emitChange('identify', { socketId: socket.id });
  return {
    cookieUserId: data.cookieUserId,
    isVerified: verification.isVerified,
    isDeterred: deterrence.isDeterred,
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
      reevaluateSocketDeterrence(socket);
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

function getVerificationStateForSocket(socket) {
  const identity = getIdentitySummary(socket);
  const pending = getPendingRequestForIdentity(identity.cookieUserId);
  return {
    isVerified: Boolean(socket?.data?.isVerified),
    pendingRequestId: pending?.id || null,
    pendingRequestedAt: pending?.createdAt || null,
  };
}

function getModerationStateForSocket(socket) {
  const data = socket?.data || {};
  return {
    isDeterred: Boolean(data.isDeterred),
    recordId: data.deterredRecordId || null,
  };
}

function isVerified(socket) {
  return Boolean(socket?.data?.isVerified);
}

function isDeterred(socket) {
  return Boolean(socket?.data?.isDeterred);
}

function parseDeterrenceSelector(selector) {
  const value = String(selector || '').trim();
  if (!value) {
    throw new Error('Selector required.');
  }
  const cookie = normalizeCookieUserId(value);
  if (cookie && isValidCookieUserId(cookie)) {
    return { cookieUserId: cookie, nickname: '', ip: null };
  }
  const ip = normalizeIp(value);
  if (ip && net.isIP(ip)) {
    return { cookieUserId: '', nickname: '', ip };
  }
  const nickname = sanitizeNickname(value);
  if (!nickname) {
    throw new Error('Selector required.');
  }
  return { cookieUserId: '', nickname, ip: null };
}

function maybeResolveVerifiedRecordForSelector(store, parsed) {
  if (parsed.cookieUserId) {
    return store.verifiedUsers.find((entry) => normalizeCookieUserId(entry.cookieUserId) === parsed.cookieUserId) || null;
  }
  if (parsed.ip) {
    return store.verifiedUsers.find((entry) => Array.isArray(entry.knownIps) && entry.knownIps.includes(parsed.ip)) || null;
  }
  const byNickname = store.verifiedUsers.filter((entry) => normalizeNicknameKey(entry.nickname) === normalizeNicknameKey(parsed.nickname));
  if (byNickname.length === 1) return byNickname[0];
  return null;
}

function listDeterredUsers() {
  const store = loadStore();
  return (store.deterredUsers || []).map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] }));
}

function deterUser(selector, options = {}) {
  const parsed = parseDeterrenceSelector(selector);
  const reasonRaw = String(options?.reason || '').trim();
  const reason = reasonRaw ? reasonRaw.slice(0, 240) : null;
  const actor = options?.actor ? String(options.actor) : null;
  const now = Date.now();

  let result = null;

  withStore((draft) => {
    const verified = maybeResolveVerifiedRecordForSelector(draft, parsed);
    const cookieUserId = parsed.cookieUserId || normalizeCookieUserId(verified?.cookieUserId || '');
    const nickname = parsed.nickname || sanitizeNickname(verified?.nickname || '');
    const knownIps = normalizeKnownIps([
      ...(parsed.ip ? [parsed.ip] : []),
      ...((verified && Array.isArray(verified.knownIps)) ? verified.knownIps : []),
    ]);

    let existing = findDeterredMatch(draft, { cookieUserId, nickname, ip: parsed.ip || null });
    if (!existing && cookieUserId) {
      existing = (draft.deterredUsers || []).find((entry) => normalizeCookieUserId(entry.cookieUserId) === cookieUserId) || null;
    }

    if (existing) {
      if (cookieUserId) {
        existing.cookieUserId = cookieUserId;
      }
      if (nickname) {
        existing.nickname = nickname;
      }
      const mergedIps = normalizeKnownIps([...(existing.knownIps || []), ...knownIps]);
      existing.knownIps = mergedIps;
      if (reason) {
        existing.reason = reason;
      }
      existing.updatedAt = now;
      existing.updatedBy = actor;
      result = { ...existing, knownIps: [...(existing.knownIps || [])], created: false };
      return;
    }

    const created = {
      id: `du_${crypto.randomBytes(8).toString('hex')}`,
      cookieUserId: cookieUserId || null,
      nickname: nickname || null,
      knownIps,
      reason,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    };
    draft.deterredUsers.push(created);
    result = { ...created, knownIps: [...(created.knownIps || [])], created: true };
  });

  io.sockets.sockets.forEach((socket) => {
    reevaluateSocketDeterrence(socket);
  });

  emitChange('deter_update');
  publishEvent({
    source: 'moderation',
    type: result?.created ? 'moderation.deterred' : 'moderation.deterrenceUpdated',
    payload: {
      id: result?.id || null,
      cookieUserId: result?.cookieUserId || null,
      nickname: result?.nickname || null,
      knownIps: result?.knownIps || [],
      reason: result?.reason || null,
      actor,
      ts: now,
    },
  });

  return result;
}

function resolveDeterredSelector(selector) {
  const store = loadStore();
  const value = String(selector || '').trim();
  if (!value) return { error: 'selector_required' };

  const byId = (store.deterredUsers || []).find((entry) => String(entry.id) === value) || null;
  if (byId) return { record: byId };

  const cookie = normalizeCookieUserId(value);
  if (cookie && isValidCookieUserId(cookie)) {
    const byCookie = (store.deterredUsers || []).find((entry) => normalizeCookieUserId(entry.cookieUserId) === cookie) || null;
    if (byCookie) return { record: byCookie };
  }

  const ip = typeof value === 'string' ? value.trim() : '';
  if (ip && net.isIP(ip)) {
    const byIp = (store.deterredUsers || []).find((entry) => Array.isArray(entry.knownIps) && entry.knownIps.includes(ip)) || null;
    if (byIp) return { record: byIp };
  }

  const nicknameKey = normalizeNicknameKey(value);
  const byNickname = (store.deterredUsers || []).filter((entry) => normalizeNicknameKey(entry.nickname) === nicknameKey);
  if (byNickname.length === 1) return { record: byNickname[0] };
  if (byNickname.length > 1) return { error: 'ambiguous_nickname' };

  return { error: 'not_found' };
}

function undeterUser(selector, removedBy = null) {
  const resolved = resolveDeterredSelector(selector);
  if (resolved.error) {
    throw new Error(
      resolved.error === 'ambiguous_nickname'
        ? 'Nickname matches multiple deterred users; remove by id or cookieUserId.'
        : 'Deterred user not found.',
    );
  }

  const target = resolved.record;
  let removed = null;

  withStore((draft) => {
    const before = draft.deterredUsers.length;
    draft.deterredUsers = draft.deterredUsers.filter((entry) => entry.id !== target.id);
    if (draft.deterredUsers.length !== before) {
      removed = target;
    }
  });

  if (!removed) {
    throw new Error('Deterred user not found.');
  }

  io.sockets.sockets.forEach((socket) => {
    reevaluateSocketDeterrence(socket);
  });

  const removedAt = Date.now();
  emitChange('deter_remove');
  publishEvent({
    source: 'moderation',
    type: 'moderation.undeterred',
    payload: {
      id: removed.id,
      cookieUserId: removed.cookieUserId || null,
      nickname: removed.nickname || null,
      removedBy: removedBy ? String(removedBy) : null,
      removedAt,
    },
  });

  return { ...removed, knownIps: [...(removed.knownIps || [])] };
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

roleEvents.on('change', ({ socket }) => {
  if (!socket) return;
  try {
    reevaluateSocketVerification(socket);
    reevaluateSocketDeterrence(socket);
    emitChange('role_change', { socketId: socket.id });
  } catch (err) {
    logger.warn('Failed to reevaluate verification on role change', err.message);
  }
});

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
  isVerified,
  isDeterred,
  reevaluateSocketVerification,
  reevaluateSocketDeterrence,
  verificationEvents,
};
