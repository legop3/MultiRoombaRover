// video Socket Service
// Purpose: Defines the video Socket Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('videoSocket');
const { getMode, MODES } = require('../modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('../roleService');
const videoSessions = require('../videoSessions');
const roverManager = require('../roverManager');
const ptzCameraService = require('../ptzCameraService');
const turnService = require('../turnService');
const { loadConfig } = require('../../helpers/configLoader');
const { getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');
const {
  shouldUseSnapshotsForNonTurnVideo,
  shouldUseSnapshotsForExternalSpectatorVideo,
} = require('../../helpers/bandwidthSavings');

const config = loadConfig();
const mediaConfig = config.media || {};

function getMediaPrefix() {
  const base = mediaConfig.whepBaseUrl;
  if (!base) {
    return '';
  }
  let prefix = base;
  try {
    const parsed = new URL(base);
    prefix = `${parsed.origin}${parsed.pathname}`;
  } catch (err) {
    // leave prefix as-is when URL parsing fails; fall back to string cleanup below
  }
  return prefix.replace(/\/+$/, '');
}

function buildWhepUrlForSource(source) {
  const cleanBase = getMediaPrefix();
  if (!cleanBase) return '';
  const segments = [];
  if (source.type === 'room') {
    segments.push('room', encodeURIComponent(source.id));
  } else if (source.type === 'ptz') {
    /*
      MediaMTX exposes WHEP by the exact path name that is being published.
      The PTZ ffmpeg publisher registers the single camera as "ptz-camera",
      so the browser must request "/video/ptz-camera/whep" instead of a
      namespace-like "/video/ptz/ptz-camera/whep" path that MediaMTX has never
      seen and correctly returns as 404.
    */
    segments.push(encodeURIComponent(source.id));
  } else {
    segments.push(encodeURIComponent(source.id));
  }
  return `${cleanBase}/${segments.join('/')}/whep`;
}

function passesMode(socket) {
  const mode = getMode();
  if (mode === MODES.LOCKDOWN) {
    return isLockdownAdmin(socket);
  }
  if (mode === MODES.ADMIN) {
    const role = getRole(socket);
    return role === 'spectator' || isAdmin(socket);
  }
  return true;
}

function canViewRover(socket, roverId) {
  if (!passesMode(socket)) {
    return false;
  }
  if (!roverManager.canSeeRover(roverId, socket)) {
    return false;
  }
  const role = getRole(socket);
  if (role === 'spectator' || isAdmin(socket)) {
    return true;
  }
  return roverManager.isDriver(roverId, socket);
}

function canViewRoomCamera(socket) {
  return passesMode(socket);
}

function countControllableUsers() {
  const ids = new Set();
  io.sockets.sockets.forEach((candidate) => {
    if (!candidate?.id || getRole(candidate) === 'spectator') return;
    /*
      Rover drivers and PTZ participants are both "controllable" users for this
      bandwidth decision because either group can create a non-turn video view.
      Counting unique socket ids prevents someone who is transitioning between
      rover and PTZ from being counted twice.
    */
    if (roverManager.getRoversForSocket(candidate.id).length > 0) {
      ids.add(candidate.id);
    }
  });
  if (typeof ptzCameraService.getParticipantSocketIds === 'function') {
    ptzCameraService.getParticipantSocketIds().forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && getRole(socket) !== 'spectator') ids.add(socketId);
    });
  }
  return ids.size;
}

function normalizeRequest(payload = {}) {
  if (!payload) return null;
  if (payload.type && payload.id) {
    return { type: payload.type, id: String(payload.id) };
  }
  if (payload.roverId) {
    return { type: 'rover', id: String(payload.roverId) };
  }
  if (payload.roomCameraId) {
    return { type: 'room', id: String(payload.roomCameraId) };
  }
  if (payload.ptzCameraId || payload.type === 'ptz') {
    return { type: 'ptz', id: String(payload.ptzCameraId || payload.id || ptzCameraService.PTZ_CAMERA_ID) };
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('video:request', (payload = {}, cb = () => {}) => {
    try {
      const target = normalizeRequest(payload);
      if (!target) {
        throw new Error('video source required');
      }
      if (target.type === 'rover') {
        const baseId = target.id.endsWith('-audio') ? target.id.slice(0, -6) : target.id;
        const isAudio = target.id.endsWith('-audio');
        if (!roverManager.rovers.has(baseId)) {
          throw new Error('Rover offline');
        }
        if (!canViewRover(socket, baseId)) {
          throw new Error('Not authorized for video');
        }
        const role = getRole(socket);
        if (role === 'spectator' && !isAdmin(socket) && !isAudio) {
          const ip = getSocketIp(socket);
          if (!isLocalNetwork(ip) && shouldUseSnapshotsForExternalSpectatorVideo()) {
            throw new Error('Not authorized for video');
          }
        }
        if (
          !isAudio &&
          role !== 'spectator' &&
          !isAdmin(socket) &&
          shouldUseSnapshotsForNonTurnVideo({ controllableUserCount: countControllableUsers() }) &&
          !turnService.canDrive(baseId, socket)
        ) {
          /*
            The browser also forces snapshots for non-active turn holders, but
            the socket token path must enforce the same rule. Otherwise a stale
            component or direct socket caller could still mint a MediaMTX token
            while the UI is showing snapshots.
          */
          throw new Error('Live video is limited to the active turn');
        }
      } else if (target.type === 'room') {
        throw new Error('Room cameras now use the snapshot feed');
      } else if (target.type === 'ptz') {
        if (target.id !== ptzCameraService.PTZ_CAMERA_ID) {
          throw new Error('Unknown PTZ camera');
        }
        if (!ptzCameraService.canRequestLiveVideo(socket)) {
          throw new Error('Not authorized for PTZ video');
        }
      } else {
        throw new Error('Unsupported video source');
      }
      const url = buildWhepUrlForSource(target);
      if (!url) {
        throw new Error('Server video base URL missing');
      }
      const sessionId = videoSessions.createSession(socket, target);
      cb({ url, token: sessionId, type: target.type, id: target.id });
    } catch (err) {
      logger.warn('video request failed: %s', err.message);
      cb({ error: err.message });
    }
  });
});
