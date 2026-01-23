const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const io = require('../globals/io');
const logger = require('../globals/logger').child('moderationService');
const { getRole, roleEvents } = require('./roleService');
const { getNickname, nicknameEvents } = require('./nicknameService');
const { getSocketIp } = require('../helpers/ipResolver');
const { parseCookieHeader } = require('../helpers/cookieParser');
const { logAdminEvent } = require('./adminLogService');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'moderation.json');
const ADMIN_ROLES = new Set(['admin', 'lockdown', 'lockdown-admin']);
const VISITOR_COOKIE = 'roverd_visitor';
const EVENT_ALLOWLIST = new Set(['auth:login']);
const MAX_HISTORY_ENTRIES = 50;

let cache = null;

function loadStore() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    cache = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load moderation store', err.message);
    }
    cache = { users: {}, bans: {}, history: [] };
  }
  if (!cache.users) cache.users = {};
  if (!cache.bans) cache.bans = {};
  if (!Array.isArray(cache.history)) cache.history = [];
  return cache;
}

function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

function isAdminSocket(socket) {
  return isAdminRole(getRole(socket));
}

function saveStore(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  cache = next;
}

function recordHistory(entry) {
  const store = loadStore();
  store.history.push(entry);
  if (store.history.length > MAX_HISTORY_ENTRIES) {
    store.history.shift();
  }
}

function parseClientId(socket) {
  const auth = socket.handshake?.auth || {};
  const clientId =
    auth.clientId ||
    socket.handshake?.query?.clientId ||
    socket.data?.clientId ||
    null;
  if (typeof clientId === 'string' && clientId.trim()) {
    return clientId.trim();
  }
  return null;
}

function parseVisitorToken(socket) {
  const cookies = parseCookieHeader(socket.handshake?.headers?.cookie || '');
  const token = cookies[VISITOR_COOKIE];
  if (typeof token === 'string' && token.trim()) {
    return token.trim();
  }
  return null;
}

function buildIdentity(socket) {
  if (!socket) return {};
  return {
    clientId: parseClientId(socket),
    visitorToken: parseVisitorToken(socket),
    ip: getSocketIp(socket),
  };
}

function findUserByIdentity(identity) {
  const store = loadStore();
  const users = Object.values(store.users || {});
  return users.find((user) => {
    if (identity.clientId && user.clientId === identity.clientId) return true;
    if (identity.visitorToken && user.visitorToken === identity.visitorToken) return true;
    if (identity.ip && Array.isArray(user.ips) && user.ips.includes(identity.ip)) return true;
    return false;
  }) || null;
}

function findUserByQuery(query) {
  if (!query) return null;
  const store = loadStore();
  const users = Object.values(store.users || {});
  return users.find((user) => {
    if (user.id === query) return true;
    if (user.clientId === query) return true;
    if (user.visitorToken === query) return true;
    if (user.lastSocketId === query) return true;
    if (Array.isArray(user.socketIds) && user.socketIds.includes(query)) return true;
    if (Array.isArray(user.nicknames) && user.nicknames.includes(query)) return true;
    if (Array.isArray(user.ips) && user.ips.includes(query)) return true;
    return false;
  }) || null;
}

function updateUserFromSocket(user, socket, identity) {
  let changed = false;
  const now = Date.now();
  if (!user.firstSeen) {
    user.firstSeen = now;
    changed = true;
  }
  if (!user.lastSeen || now > user.lastSeen) {
    user.lastSeen = now;
    changed = true;
  }
  const role = getRole(socket);
  if (user.lastRole !== role) {
    user.lastRole = role;
    changed = true;
  }
  const nickname = getNickname(socket) || null;
  if (nickname) {
    user.nicknames = Array.isArray(user.nicknames) ? user.nicknames : [];
    if (!user.nicknames.includes(nickname)) {
      user.nicknames.push(nickname);
      changed = true;
    }
  }
  if (identity.clientId && user.clientId !== identity.clientId) {
    user.clientId = identity.clientId;
    changed = true;
  }
  if (identity.visitorToken && user.visitorToken !== identity.visitorToken) {
    user.visitorToken = identity.visitorToken;
    changed = true;
  }
  if (identity.ip) {
    user.ips = Array.isArray(user.ips) ? user.ips : [];
    if (!user.ips.includes(identity.ip)) {
      user.ips.push(identity.ip);
      changed = true;
    }
    user.lastIp = identity.ip;
  }
  if (user.lastSocketId !== socket.id) {
    user.lastSocketId = socket.id;
    changed = true;
  }
  user.socketIds = Array.isArray(user.socketIds) ? user.socketIds : [];
  if (!user.socketIds.includes(socket.id)) {
    user.socketIds.push(socket.id);
    changed = true;
  }
  if (ADMIN_ROLES.has(role) && !user.admin) {
    user.admin = true;
    user.adminName = socket?.data?.user?.username || null;
    changed = true;
  }
  return changed;
}

function ensureUserForSocket(socket) {
  const store = loadStore();
  const identity = buildIdentity(socket);
  let user = findUserByIdentity(identity);
  if (!user) {
    user = {
      id: uuidv4(),
      clientId: identity.clientId || null,
      visitorToken: identity.visitorToken || null,
      ips: identity.ip ? [identity.ip] : [],
      nicknames: [],
      socketIds: [],
      firstSeen: null,
      lastSeen: null,
      lastRole: null,
      lastSocketId: null,
      lastIp: identity.ip || null,
      admin: false,
      adminName: null,
    };
    store.users[user.id] = user;
  }
  const changed = updateUserFromSocket(user, socket, identity);
  socket.data.moderation = { userId: user.id, ...identity };
  if (changed) {
    if (user.admin) {
      clearBansForUser(user, { reason: 'Admin role applied' });
    }
    saveStore(store);
    emitModerationSnapshot();
  }
  return user;
}

function cleanupExpiredBans() {
  const store = loadStore();
  const now = Date.now();
  let changed = false;
  Object.values(store.bans || {}).forEach((ban) => {
    if (ban.expiresAt && ban.expiresAt <= now) {
      delete store.bans[ban.id];
      changed = true;
    }
  });
  if (changed) {
    saveStore(store);
  }
  return changed;
}

function banMatchesIdentity(ban, identity) {
  if (!ban) return false;
  if (ban.userId && identity.userId && ban.userId === identity.userId) return true;
  if (ban.clientId && identity.clientId && ban.clientId === identity.clientId) return true;
  if (ban.visitorToken && identity.visitorToken && ban.visitorToken === identity.visitorToken) return true;
  if (ban.ip && identity.ip && ban.ip === identity.ip) return true;
  return false;
}

function findActiveBan(identity) {
  cleanupExpiredBans();
  const store = loadStore();
  const bans = Object.values(store.bans || {});
  return (
    bans.find((ban) => {
      if (ban.expiresAt && ban.expiresAt <= Date.now()) return false;
      return banMatchesIdentity(ban, identity);
    }) || null
  );
}

function isBannedSocket(socket) {
  if (!socket || isAdminSocket(socket)) return false;
  const identity = socket.data?.moderation || buildIdentity(socket);
  identity.userId = identity.userId || socket.data?.moderation?.userId || null;
  return Boolean(findActiveBan(identity));
}

function refreshSocketStatus(socket) {
  if (!socket) return;
  if (isAdminSocket(socket)) {
    if (socket.data?.banInfo) {
      socket.data.banInfo = null;
      socket.emit('moderation:status', { banned: false });
    }
    return;
  }
  const identity = { ...(socket.data?.moderation || buildIdentity(socket)) };
  const ban = findActiveBan(identity);
  const prevId = socket.data?.banInfo?.id || null;
  if (!ban && prevId) {
    socket.data.banInfo = null;
    socket.emit('moderation:status', { banned: false });
    return;
  }
  if (!ban) {
    socket.data.banInfo = null;
    socket.emit('moderation:status', { banned: false });
    return;
  }
  if (prevId !== ban.id) {
    socket.data.banInfo = ban;
    socket.emit('moderation:status', {
      banned: true,
      reason: ban.reason || null,
      expiresAt: ban.expiresAt || null,
      createdAt: ban.createdAt || null,
    });
  }
}

function serializeUser(user) {
  const activeBan = findActiveBan({ userId: user.id, clientId: user.clientId, visitorToken: user.visitorToken, ip: user.lastIp });
  return {
    id: user.id,
    clientId: user.clientId || null,
    visitorToken: user.visitorToken || null,
    ips: user.ips || [],
    nicknames: user.nicknames || [],
    lastSeen: user.lastSeen || null,
    firstSeen: user.firstSeen || null,
    lastRole: user.lastRole || null,
    lastSocketId: user.lastSocketId || null,
    admin: Boolean(user.admin),
    adminName: user.adminName || null,
    ban: activeBan
      ? {
          id: activeBan.id,
          reason: activeBan.reason || null,
          createdAt: activeBan.createdAt || null,
          expiresAt: activeBan.expiresAt || null,
          createdBy: activeBan.createdBy || null,
        }
      : null,
  };
}

function getModerationSnapshot() {
  cleanupExpiredBans();
  const store = loadStore();
  return {
    users: Object.values(store.users || {}).map(serializeUser),
    bans: Object.values(store.bans || {}),
  };
}

function emitModerationSnapshot() {
  const payload = getModerationSnapshot();
  io.sockets.sockets.forEach((socket) => {
    if (!isAdminSocket(socket)) return;
    socket.emit('moderation:update', payload);
  });
}

function clearBansForUser(user, meta = {}) {
  if (!user) return false;
  const store = loadStore();
  let changed = false;
  Object.values(store.bans || {}).forEach((ban) => {
    if (ban.userId === user.id) {
      delete store.bans[ban.id];
      changed = true;
    }
    if (user.clientId && ban.clientId === user.clientId) {
      delete store.bans[ban.id];
      changed = true;
    }
    if (user.visitorToken && ban.visitorToken === user.visitorToken) {
      delete store.bans[ban.id];
      changed = true;
    }
    if (user.lastIp && ban.ip === user.lastIp) {
      delete store.bans[ban.id];
      changed = true;
    }
  });
  if (changed) {
    recordHistory({
      id: uuidv4(),
      action: 'unban',
      createdAt: Date.now(),
      createdBy: meta.by || null,
      reason: meta.reason || null,
      userId: user.id,
    });
    saveStore(store);
  }
  return changed;
}

function resolveTarget(target = {}) {
  if (typeof target === 'string') {
    const query = target.trim();
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(query)) {
      return { ip: query, query };
    }
    return { query };
  }
  return target;
}

function createBan(target, { durationMs = null, reason = null, createdBy = null } = {}) {
  cleanupExpiredBans();
  const store = loadStore();
  const resolved = resolveTarget(target);
  const query = resolved.query || null;
  const user =
    resolved.userId ? store.users[resolved.userId] || null : findUserByQuery(query || resolved.socketId || resolved.nickname || resolved.clientId || resolved.visitorToken || resolved.ip);
  if (user && user.admin) {
    throw new Error('Admins cannot be banned.');
  }
  if (resolved.ip) {
    const adminMatch = Object.values(store.users || {}).some(
      (entry) => entry.admin && Array.isArray(entry.ips) && entry.ips.includes(resolved.ip),
    );
    if (adminMatch) {
      throw new Error('Admins cannot be banned.');
    }
  }
  const identity = {
    userId: user?.id || null,
    clientId: resolved.clientId || user?.clientId || null,
    visitorToken: resolved.visitorToken || user?.visitorToken || null,
    ip: resolved.ip || user?.lastIp || null,
  };
  if (!identity.userId && !identity.clientId && !identity.visitorToken && !identity.ip) {
    throw new Error('Unknown user.');
  }
  const cleanReason = typeof reason === 'string' ? reason.trim() : null;
  const safeDuration = typeof durationMs === 'number' && durationMs > 0 ? durationMs : null;
  const ban = {
    id: uuidv4(),
    userId: identity.userId,
    clientId: identity.clientId,
    visitorToken: identity.visitorToken,
    ip: identity.ip,
    reason: cleanReason || null,
    createdAt: Date.now(),
    expiresAt: safeDuration ? Date.now() + safeDuration : null,
    createdBy: createdBy || null,
  };
  Object.values(store.bans || {}).forEach((existing) => {
    if (banMatchesIdentity(existing, identity)) {
      delete store.bans[existing.id];
    }
  });
  store.bans[ban.id] = ban;
  recordHistory({
    id: uuidv4(),
    action: durationMs ? 'timeout' : 'ban',
    createdAt: ban.createdAt,
    createdBy: ban.createdBy,
    reason: ban.reason,
    userId: ban.userId || null,
    banId: ban.id,
    expiresAt: ban.expiresAt,
  });
  saveStore(store);
  return ban;
}

function removeBan(target) {
  cleanupExpiredBans();
  const store = loadStore();
  const resolved = resolveTarget(target);
  const banId = resolved.banId || resolved.query;
  if (banId && store.bans[banId]) {
    delete store.bans[banId];
    saveStore(store);
    return true;
  }
  const query = resolved.query || null;
  const user =
    resolved.userId ? store.users[resolved.userId] || null : findUserByQuery(query || resolved.socketId || resolved.nickname || resolved.clientId || resolved.visitorToken || resolved.ip);
  if (user) {
    const changed = clearBansForUser(user, { by: resolved.by || null, reason: resolved.reason || null });
    if (changed) {
      saveStore(store);
    }
    return changed;
  }
  if (resolved.ip) {
    let removed = false;
    Object.values(store.bans || {}).forEach((ban) => {
      if (ban.ip === resolved.ip) {
        delete store.bans[ban.id];
        removed = true;
      }
    });
    if (removed) {
      saveStore(store);
    }
    return removed;
  }
  return false;
}

function applyBan(target, options) {
  const ban = createBan(target, options);
  emitModerationSnapshot();
  io.sockets.sockets.forEach((socket) => refreshSocketStatus(socket));
  return ban;
}

function applyUnban(target) {
  const removed = removeBan(target);
  if (removed) {
    emitModerationSnapshot();
    io.sockets.sockets.forEach((socket) => refreshSocketStatus(socket));
  }
  return removed;
}

function registerSocket(socket) {
  const user = ensureUserForSocket(socket);
  refreshSocketStatus(socket);
  socket.use((packet, next) => {
    if (!packet || !packet.length) return next();
    const event = packet[0];
    if (EVENT_ALLOWLIST.has(event)) return next();
    if (isAdminSocket(socket)) return next();
    if (isBannedSocket(socket)) {
      return next(new Error('banned'));
    }
    return next();
  });
  socket.on('disconnect', () => {
    const store = loadStore();
    if (!store.users[user.id]) return;
    store.users[user.id].lastSeen = Date.now();
    saveStore(store);
  });
}

io.on('connection', (socket) => {
  registerSocket(socket);
  if (isAdminSocket(socket)) {
    socket.emit('moderation:init', getModerationSnapshot());
  }
  socket.on('moderation:ban', ({ target, durationMs, reason } = {}, cb = () => {}) => {
    if (!isAdminSocket(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      const ban = applyBan(target, {
        durationMs: durationMs || null,
        reason,
        createdBy: socket?.data?.user?.username || socket.id,
      });
      logAdminEvent({
        label: 'moderation',
        message: durationMs ? 'User timed out' : 'User banned',
        ip: socket?.data?.moderation?.ip || null,
        meta: { target, reason, expiresAt: ban.expiresAt || null },
        socketId: socket.id,
      });
      cb({ success: true, ban });
    } catch (err) {
      cb({ error: err.message });
    }
  });
  socket.on('moderation:unban', ({ target } = {}, cb = () => {}) => {
    if (!isAdminSocket(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      const removed = applyUnban({ ...target, by: socket?.data?.user?.username || socket.id });
      if (removed) {
        logAdminEvent({
          label: 'moderation',
          message: 'User unbanned',
          ip: socket?.data?.moderation?.ip || null,
          meta: { target },
          socketId: socket.id,
        });
      }
      cb({ success: true, removed });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

roleEvents.on('change', ({ socket, role }) => {
  if (!socket) return;
  if (ADMIN_ROLES.has(role)) {
    const user = ensureUserForSocket(socket);
    if (user.admin) {
      clearBansForUser(user, { reason: 'Admin role applied', by: socket?.data?.user?.username || socket.id });
      emitModerationSnapshot();
      refreshSocketStatus(socket);
    }
    socket.emit('moderation:init', getModerationSnapshot());
  }
});

nicknameEvents.on('change', ({ socketId }) => {
  const socket = socketId ? io.sockets.sockets.get(socketId) : null;
  if (socket) {
    const store = loadStore();
    const identity = buildIdentity(socket);
    const user = findUserByIdentity(identity);
    if (user) {
      const changed = updateUserFromSocket(user, socket, identity);
      if (changed) {
        saveStore(store);
        emitModerationSnapshot();
      }
    }
  }
});

setInterval(() => {
  const expired = cleanupExpiredBans();
  if (expired) {
    emitModerationSnapshot();
    io.sockets.sockets.forEach((socket) => refreshSocketStatus(socket));
  }
}, 30 * 1000);

module.exports = {
  buildIdentity,
  getModerationSnapshot,
  isBannedSocket,
  findUserByQuery,
  createBan,
  removeBan,
  applyBan,
  applyUnban,
  refreshSocketStatus,
};
