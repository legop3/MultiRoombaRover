const io = require('../globals/io');
const logger = require('../globals/logger').child('sessionService');
const { getRole, roleEvents } = require('./roleService');
const { getMode, modeEvents } = require('./modeManager');
const roverManager = require('./roverManager');
const { managerEvents } = roverManager;
const assignmentService = require('./assignmentService');
const { getActiveDrivers, getTurnQueues, turnEvents } = require('./turnService');
const { getRoomCameras, roomCameraEvents } = require('./roomCameraService');
const { getState: getHomeAssistantState, homeAssistantEvents } = require('./homeAssistantService');
const { getNickname, nicknameEvents } = require('./nicknameService');
const { getReplayState, replayEvents } = require('./replayService');
const { getReplaySources } = require('./replaySourceService');
const { getHealthSnapshot } = require('./healthService');
const { loadConfig } = require('../helpers/configLoader');
const { getCommunityGoal } = require('./communityGoalService');
const { subscribe } = require('./eventBus');

const discordInvite = loadConfig().discord?.invite || null;
const kofiLink = loadConfig().kofi?.link || null;
logger.info('Discord invite loaded:', discordInvite ? 'present' : 'not configured');
logger.info('Ko-fi link loaded:', kofiLink ? 'present' : 'not configured');

const ACTIVITY_SYNC_COOLDOWN_MS = 3000;
const ADMIN_ROLES = new Set(['admin', 'lockdown', 'lockdown-admin']);
let lastActivitySync = 0;
let pendingActivitySync = null;

function extractSocketIp(socket) {
  if (!socket) return null;
  const headers = socket.handshake?.headers || {};
  const forwardedFor = headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length) {
    return String(forwardedFor[0]).trim();
  }
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return (
    socket.handshake?.address ||
    socket.conn?.remoteAddress ||
    socket.request?.connection?.remoteAddress ||
    null
  );
}

function buildUserEntry(socket, includeIp = false) {
  if (!socket) return null;
  const role = getRole(socket);
  const assignment = assignmentService.describeAssignment(socket.id);
  const primaryRover = roverManager.getPrimaryRoverForSocket(socket.id);
  return {
    socketId: socket.id,
    nickname: getNickname(socket) || null,
    role,
    roverId: primaryRover || assignment?.roverId || null,
    ip: includeIp ? extractSocketIp(socket) : null,
  };
}

function buildSession(socket) {
  const includeIps = ADMIN_ROLES.has(getRole(socket));
  const users = Array.from(io.sockets.sockets.values())
    .map((sock) => buildUserEntry(sock, includeIps))
    .filter(Boolean);
  return {
    socketId: socket?.id || null,
    role: getRole(socket),
    mode: getMode(),
    roster: roverManager.getRoster(),
    assignment: assignmentService.describeAssignment(socket?.id || ''),
    activeDrivers: getActiveDrivers(),
    turnQueues: getTurnQueues(),
    roomCameras: getRoomCameras(),
    homeAssistant: getHomeAssistantState(),
    replay: getReplayState(),
    replaySources: getReplaySources(),
    health: getHealthSnapshot(),
    communityGoal: getCommunityGoal(),
    users,
    discord: {
      invite: discordInvite,
    },
    kofi: {
      link: kofiLink,
    },
  };
}

function syncSocket(socket) {
  if (!socket) return;
  const payload = buildSession(socket);
  logger.info('Syncing session', socket.id, payload.role, payload.assignment);
  socket.emit('session:sync', payload);
}

function syncAll() {
  logger.info('Broadcasting session sync to all sockets');
  io.sockets.sockets.forEach((socket) => syncSocket(socket));
}

io.on('connection', (socket) => {
  logger.info('New socket connected', socket.id);
  syncSocket(socket);
});

roleEvents.on('change', ({ socket }) => {
  if (!socket) return;
  logger.info('Role changed; syncing session', socket.id);
  syncSocket(socket);
});

assignmentService.assignmentEvents.on('update', (socketId) => {
  const socket = io.sockets.sockets.get(socketId);
  if (socket) {
    logger.info('Assignment update; syncing session', socketId);
    syncSocket(socket);
  }
});

modeEvents.on('change', () => {
  logger.info('Mode change detected; syncing all clients');
  syncAll();
});

managerEvents.on('rover', () => {
  logger.info('Rover roster change; syncing all clients');
  syncAll();
});

managerEvents.on('lock', ({ roverId, locked }) => {
  logger.info('Rover lock change', roverId, locked);
  syncAll();
});

managerEvents.on('driver', ({ socketId }) => {
  if (!socketId) return;
  const socket = io.sockets.sockets.get(socketId);
  if (socket) {
    logger.info('Driver assignment change; syncing session', socketId);
    syncSocket(socket);
  }
});

turnEvents.on('activeDriver', () => {
  logger.info('Active driver change; syncing all clients');
  syncAll();
});
turnEvents.on('queue', (event = {}) => {
  const { reason } = event;
  if (reason === 'activity') {
    const now = Date.now();
    const elapsed = now - lastActivitySync;
    if (elapsed >= ACTIVITY_SYNC_COOLDOWN_MS) {
      lastActivitySync = now;
      logger.info('Turn activity; syncing all clients (immediate)');
      syncAll();
      return;
    }
    if (!pendingActivitySync) {
      const delay = ACTIVITY_SYNC_COOLDOWN_MS - elapsed;
      pendingActivitySync = setTimeout(() => {
        lastActivitySync = Date.now();
        pendingActivitySync = null;
        logger.info('Turn activity; syncing all clients (delayed)');
        syncAll();
      }, delay);
    }
    return;
  }
  if (pendingActivitySync) {
    clearTimeout(pendingActivitySync);
    pendingActivitySync = null;
  }
  logger.info('Turn queue change; syncing all clients');
  syncAll();
});

roomCameraEvents.on('update', () => {
  logger.info('Room camera change detected; syncing all clients');
  syncAll();
});

homeAssistantEvents.on('update', () => {
  logger.info('Home Assistant state change; syncing all clients');
  syncAll();
});

homeAssistantEvents.on('status', () => {
  logger.info('Home Assistant status change; syncing all clients');
  syncAll();
});

replayEvents.on('update', () => {
  logger.info('Replay cooldown updated; syncing all clients');
  syncAll();
});

nicknameEvents.on('change', ({ socketId }) => {
  const socket = socketId ? io.sockets.sockets.get(socketId) : null;
  if (socket) {
    logger.info('Nickname change; syncing session', socketId);
    syncSocket(socket);
  } else {
    syncAll();
  }
});

subscribe('communityGoal.updated', () => {
  logger.info('Community goal updated; syncing all clients');
  syncAll();
});

// sync all sockets 20 seconds
setInterval(() => {
  logger.info('Periodic session sync for all clients');
  syncAll();
}, 20000);

module.exports = {
  buildSession,
  syncSocket,
  syncAll,
};
