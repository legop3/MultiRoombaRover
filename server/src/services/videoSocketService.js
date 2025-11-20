const io = require('../globals/io');
const logger = require('../globals/logger').child('videoSocket');
const { getMode, MODES } = require('./modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('./roleService');
const videoSessions = require('./videoSessions');
const roverManager = require('./roverManager');
const { getRoomCamera } = require('./roomCameraService');
const { loadConfig } = require('../helpers/configLoader');

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
  } else {
    segments.push(encodeURIComponent(source.id));
  }
  return `${cleanBase}/${segments.join('/')}/whep`;
}

function passesMode(socket) {
  const mode = getMode();
  if (mode === MODES.LOCKDOWN && !isLockdownAdmin(socket)) {
    return false;
  }
  if (mode === MODES.ADMIN && !isAdmin(socket)) {
    return false;
  }
  return true;
}

function canViewRover(socket, roverId) {
  if (!passesMode(socket)) {
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
        if (!roverManager.rovers.has(target.id)) {
          throw new Error('Rover offline');
        }
        if (!canViewRover(socket, target.id)) {
          throw new Error('Not authorized for video');
        }
      } else if (target.type === 'room') {
        if (!getRoomCamera(target.id)) {
          throw new Error('Unknown room camera');
        }
        if (!canViewRoomCamera(socket)) {
          throw new Error('Not authorized for room camera');
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
