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
const { loadConfig } = require('../helpers/configLoader');

const discordInvite = loadConfig().discord?.invite || null;
logger.info('Discord invite loaded:', discordInvite ? 'present' : 'not configured');

const ACTIVITY_SYNC_COOLDOWN_MS = 3000;
let lastActivitySync = 0;
let pendingActivitySync = null;

function buildUserEntry(socket) {
  if (!socket) return null;
  const role = getRole(socket);
  const assignment = assignmentService.describeAssignment(socket.id);
  const primaryRover = roverManager.getPrimaryRoverForSocket(socket.id);
  return {
    socketId: socket.id,
    nickname: getNickname(socket) || null,
    role,
    roverId: primaryRover || assignment?.roverId || null,
  };
}

function buildSession(socket) {
  const users = Array.from(io.sockets.sockets.values())
    .map((sock) => buildUserEntry(sock))
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
    users,
    discord: {
      invite: discordInvite,
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

nicknameEvents.on('change', ({ socketId }) => {
  const socket = socketId ? io.sockets.sockets.get(socketId) : null;
  if (socket) {
    logger.info('Nickname change; syncing session', socketId);
    syncSocket(socket);
  } else {
    syncAll();
  }
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
