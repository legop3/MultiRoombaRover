// session Service
// Purpose: Defines the session Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('sessionService');
const { getRole, roleEvents } = require('../roleService');
const { getMode, modeEvents } = require('../modeManager');
const roverManager = require('../roverManager');
const { managerEvents } = roverManager;
const assignmentService = require('../assignmentService');
const { getActiveDrivers, getTurnQueues, turnEvents } = require('../turnService');
const { getRoomCameras, roomCameraEvents } = require('../roomCameraService');
const { getState: getHomeAssistantState, homeAssistantEvents } = require('../homeAssistantService');
const { getState: getNeatoState, neatoEvents } = require('../neatoService');
const { getState: getLiftState, liftEvents } = require('../liftService');
const { getState: getKinectState, kinectEvents } = require('../kinectService');
const { getVoteStatus: getOverseerVoteStatus } = require('../overseerControlService');
const { getNickname, nicknameEvents } = require('../nicknameService');
const {
  getVerificationStateForSocket,
  getModerationStateForSocket,
  getIdentitySummary,
  verificationEvents,
} = require('../verificationService');
const {
  getStateForSocket: getPrivateRoverAccessStateForSocket,
  requestEvents: privateRoverAccessRequestEvents,
} = require('../privateRoverAccessRequestService');
const { getReplayState, replayEvents, getReplaySources } = require('../replayEngineV2');
const { getHealthSnapshot } = require('../healthService');
const { getGlobalObjective } = require('../globalObjectiveService');
const { getAdminReason } = require('../adminReasonService');
const { subscribe } = require('../eventBus');
const { getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');
const { getAudioForwardState, audioForwardEvents } = require('../audioForwardService');
const { getAudioLevels, audioLevelsEvents } = require('../audioLevelsService');
const { getButtonBoxState } = require('../buttonBoxService');
const {
  discordInvite,
  kofiLink,
  serverTimezone,
  configuredSocials,
  ACTIVITY_SYNC_COOLDOWN_MS,
  NIGHT_VISION_SYNC_COOLDOWN_MS,
  PERIODIC_SYNC_MS,
} = require('./constants');
const { getState, setState } = require('./state');
const {
  filterVisibleRoverId,
  filterActiveDriversForSocket,
  filterTurnQueuesForSocket,
} = require('./filters');
logger.info('Discord invite loaded:', discordInvite ? 'present' : 'not configured');
logger.info('Ko-fi link loaded:', kofiLink ? 'present' : 'not configured');
logger.info('Socials config loaded:', configuredSocials?.length ? `${configuredSocials.length} entries` : 'not configured');

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
  const overseerVote = getOverseerVoteStatus();
  const users = Array.from(io.sockets.sockets.values())
    .map((sock) => buildUserEntry(sock))
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      roverId: filterVisibleRoverId(socket, entry.roverId),
    }));
  const roster = roverManager.getRosterForSocket(socket);
  const assignment = assignmentService.describeAssignment(socket?.id || '');
  const assignmentRoverId = filterVisibleRoverId(socket, assignment?.roverId);
  const activeDrivers = filterActiveDriversForSocket(getActiveDrivers(), socket);
  const turnQueues = filterTurnQueuesForSocket(getTurnQueues(), socket);
  const socials =
    configuredSocials?.length
      ? configuredSocials
      : [
          ...(discordInvite ? [{ id: 'discord', label: 'Discord', url: discordInvite }] : []),
          ...(kofiLink ? [{ id: 'kofi', label: 'Ko-fi', url: kofiLink }] : []),
        ];
  return {
    socketId: socket?.id || null,
    role: getRole(socket),
    mode: getMode(),
    isLocalNetwork: isLocalNetwork(getSocketIp(socket)),
    roster,
    assignment: {
      ...assignment,
      roverId: assignmentRoverId,
      status: assignmentRoverId ? assignment.status : assignment.status === 'waiting' ? 'waiting' : null,
    },
    activeDrivers,
    turnQueues,
    roomCameras: getRoomCameras(),
    homeAssistant: getHomeAssistantState(),
    neato: getNeatoState(),
    lift: getLiftState(),
    kinect: getKinectState(),
    replay: getReplayState(),
    replaySources: getReplaySources(socket),
    health: getHealthSnapshot(),
    globalObjective: getGlobalObjective(),
    adminReason: getAdminReason(),
    users,
    socials,
    discord: {
      invite: discordInvite,
    },
    timezone: serverTimezone,
    kofi: {
      link: kofiLink,
    },
    identity: getIdentitySummary(socket),
    verification: getVerificationStateForSocket(socket),
    moderation: getModerationStateForSocket(socket),
    privateRoverAccess: getPrivateRoverAccessStateForSocket(socket),
    isVerified: Boolean(socket?.data?.isVerified),
    audioForward: getAudioForwardState(),
    audioLevels: getAudioLevels(),
    buttonBox: getButtonBoxState(),
    overseerVote: {
      ...overseerVote,
      preference: typeof socket?.data?.overseerEnabled === 'boolean' ? socket.data.overseerEnabled : true,
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

managerEvents.on('rover', (event = {}) => {
  const state = getState();
  if (event.action === 'nightVision') {
    const now = Date.now();
    const elapsed = now - state.lastNightVisionSync;
    if (elapsed >= NIGHT_VISION_SYNC_COOLDOWN_MS) {
      setState({ lastNightVisionSync: now });
      logger.info('Night vision update; syncing all clients (immediate)');
      syncAll();
      return;
    }
    if (!state.pendingNightVisionSync) {
      const delay = NIGHT_VISION_SYNC_COOLDOWN_MS - elapsed;
      const timer = setTimeout(() => {
        setState({ lastNightVisionSync: Date.now(), pendingNightVisionSync: null });
        logger.info('Night vision update; syncing all clients (delayed)');
        syncAll();
      }, delay);
      setState({ pendingNightVisionSync: timer });
    }
    return;
  }
  if (state.pendingNightVisionSync) {
    clearTimeout(state.pendingNightVisionSync);
    setState({ pendingNightVisionSync: null });
  }
  logger.info('Rover roster change; syncing all clients');
  syncAll();
});

managerEvents.on('lock', ({ roverId, locked }) => {
  logger.info('Rover lock change', roverId, locked);
  syncAll();
});

managerEvents.on('private', ({ roverId, open }) => {
  logger.info('Private rover visibility change', roverId, open);
  syncAll();
});

managerEvents.on('privateSafety', ({ roverId }) => {
  logger.info('Private rover safety config changed', roverId);
  syncAll();
});

privateRoverAccessRequestEvents.on('change', (event = {}) => {
  logger.info('Private rover access request state changed', event.reason || 'unknown');
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
  const state = getState();
  const { reason } = event;
  if (reason === 'activity') {
    const now = Date.now();
    const elapsed = now - state.lastActivitySync;
    if (elapsed >= ACTIVITY_SYNC_COOLDOWN_MS) {
      setState({ lastActivitySync: now });
      logger.info('Turn activity; syncing all clients (immediate)');
      syncAll();
      return;
    }
    if (!state.pendingActivitySync) {
      const delay = ACTIVITY_SYNC_COOLDOWN_MS - elapsed;
      const timer = setTimeout(() => {
        setState({ lastActivitySync: Date.now(), pendingActivitySync: null });
        logger.info('Turn activity; syncing all clients (delayed)');
        syncAll();
      }, delay);
      setState({ pendingActivitySync: timer });
    }
    return;
  }
  if (state.pendingActivitySync) {
    clearTimeout(state.pendingActivitySync);
    setState({ pendingActivitySync: null });
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

neatoEvents.on('update', () => {
  logger.info('Neato state change; syncing all clients');
  syncAll();
});

liftEvents.on('update', () => {
  logger.info('Lift state change; syncing all clients');
  syncAll();
});

kinectEvents.on('change', () => {
  logger.info('Kinect state change; syncing all clients');
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

verificationEvents.on('change', ({ socketId } = {}) => {
  if (socketId) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      syncSocket(socket);
      return;
    }
  }
  syncAll();
});

subscribe('globalObjective.updated', () => {
  logger.info('Global objective updated; syncing all clients');
  syncAll();
});

subscribe('adminReason.updated', () => {
  logger.info('Admin reason updated; syncing all clients');
  syncAll();
});

subscribe('buttonBox.updated', () => {
  syncAll();
});

audioForwardEvents.on('change', () => {
  syncAll();
});

audioLevelsEvents.on('change', () => {
  syncAll();
});

// sync all sockets 20 seconds
// setInterval(() => {
//   logger.info('Periodic session sync for all clients');
//   syncAll();
// }, PERIODIC_SYNC_MS);

module.exports = {
  buildSession,
  syncSocket,
  syncAll,
};
