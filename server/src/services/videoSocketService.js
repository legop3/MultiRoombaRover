const io = require('../globals/io');
const logger = require('../globals/logger').child('videoSocket');
const { getMode, MODES } = require('./modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('./roleService');
const videoSessions = require('./videoSessions');
const roverManager = require('./roverManager');
const { loadConfig } = require('../helpers/configLoader');

const config = loadConfig();
const mediaConfig = config.media || {};

function buildWhepUrl(roverId) {
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
  const cleanBase = prefix.replace(/\/+$/, '');
  const encodedId = encodeURIComponent(roverId);
  return `${cleanBase}/${encodedId}/whep`;
}

function canView(socket, roverId) {
  const mode = getMode();
  if (mode === MODES.LOCKDOWN && !isLockdownAdmin(socket)) {
    return false;
  }
  if (mode === MODES.ADMIN && !isAdmin(socket)) {
    return false;
  }
  const role = getRole(socket);
  if (role === 'spectator' || isAdmin(socket)) {
    return true;
  }
  return roverManager.isDriver(roverId, socket);
}

io.on('connection', (socket) => {
  socket.on('video:request', ({ roverId } = {}, cb = () => {}) => {
    try {
      if (!roverId) {
        throw new Error('roverId required');
      }
      if (!roverManager.rovers.has(roverId)) {
        throw new Error('Rover offline');
      }
      if (!canView(socket, roverId)) {
        throw new Error('Not authorized for video');
      }
      const url = buildWhepUrl(roverId);
      if (!url) {
        throw new Error('Server video base URL missing');
      }
      const sessionId = videoSessions.createSession(socket, roverId);
      cb({ url, token: sessionId });
    } catch (err) {
      logger.warn('video request failed: %s', err.message);
      cb({ error: err.message });
    }
  });
});
