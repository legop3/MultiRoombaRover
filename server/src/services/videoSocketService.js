const io = require('../globals/io');
const logger = require('../globals/logger').child('videoSocket');
const { getMode, MODES } = require('./modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('./roleService');
const videoSessions = require('./videoSessions');
const roverManager = require('./roverManager');
const { loadConfig } = require('../helpers/configLoader');

const config = loadConfig();
const mediaConfig = config.media || {};

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
      if (!mediaConfig.whepBaseUrl) {
        throw new Error('Server video base URL missing');
      }
      if (!roverId) {
        throw new Error('roverId required');
      }
      if (!canView(socket, roverId)) {
        throw new Error('Not authorized for video');
      }
      const sessionId = videoSessions.createSession(socket, roverId);
      const url = `${mediaConfig.whepBaseUrl.replace(/\/$/, '')}/${roverId}`;
      cb({ url, token: sessionId });
    } catch (err) {
      logger.warn('video request failed: %s', err.message);
      cb({ error: err.message });
    }
  });
});
