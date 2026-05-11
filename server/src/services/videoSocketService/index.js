// video Socket Service
// Purpose: Defines the video Socket Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('videoSocket');
const { getMode, MODES } = require('../modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('../roleService');
const videoSessions = require('../videoSessions');
const roverManager = require('../roverManager');
const { loadConfig } = require('../../helpers/configLoader');
const { getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');

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
  return `${cleanBase}/${encodeURIComponent(source.id)}/whep`;
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

function normalizeRequest(payload = {}) {
  if (!payload) return null;
  if (payload.type && payload.id && payload.type === 'rover') {
    return { type: 'rover', id: String(payload.id) };
  }
  if (payload.roverId) {
    return { type: 'rover', id: String(payload.roverId) };
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
        if (!isLocalNetwork(ip)) {
          throw new Error('Not authorized for video');
        }
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
