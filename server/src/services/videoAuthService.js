const { app } = require('../globals/http');
const io = require('../globals/io');
const logger = require('../globals/logger').child('videoAuth');
const videoSessions = require('./videoSessions');
const { getMode, MODES } = require('./modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('./roleService');
const roverManager = require('./roverManager');

function canView(socket) {
  const mode = getMode();
  if (!socket) {
    return false;
  }
  if (mode === MODES.LOCKDOWN) {
    return isLockdownAdmin(socket);
  }
  if (mode === MODES.ADMIN) {
    return isAdmin(socket);
  }
  return true;
}

app.get('/mediamtx/auth', (req, res) => {
  const { session: sessionId, roverId } = req.query;
  if (!sessionId || !roverId) {
    logger.warn('auth missing session or rover');
    return res.status(401).end();
  }

  const info = videoSessions.getSession(sessionId);
  if (!info || info.roverId !== roverId) {
    logger.warn('invalid session %s', sessionId);
    return res.status(401).end();
  }
  const socket = io.sockets.sockets.get(info.socketId);
  if (!socket) {
    videoSessions.revokeSession(sessionId);
    return res.status(401).end();
  }
  if (!canView(socket)) {
    return res.status(401).end();
  }
  // optionally ensure non-admin drivers only view their rover
  const role = getRole(socket);
  if (role !== 'spectator' && !isAdmin(socket)) {
    if (!roverManager.isDriver(roverId, socket)) {
      return res.status(401).end();
    }
  }

  return res.status(200).end();
});
