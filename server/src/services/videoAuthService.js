const { app } = require('../globals/http');
const io = require('../globals/io');
const logger = require('../globals/logger').child('videoAuth');
const videoSessions = require('./videoSessions');
const { getMode, MODES } = require('./modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('./roleService');
const roverManager = require('./roverManager');
const { loadConfig } = require('../helpers/configLoader');

const config = loadConfig();
const mediaConfig = config.media || {};

function getPathPrefix() {
  const base = mediaConfig.whepBaseUrl;
  if (!base) return '';
  try {
    const parsed = new URL(base);
    return parsed.pathname || '';
  } catch {
    return base.replace(/^[^/]*:\/\//, '').replace(/^[^/]+/, '');
  }
}

const whepPathPrefix = getPathPrefix().replace(/\/+$/, '').replace(/^\/+/, '');

function extractRoverId(path) {
  let clean = (path || '').replace(/^\//, '');
  if (!clean) return '';
  if (clean.endsWith('/whep')) {
    clean = clean.slice(0, -'/whep'.length);
  }
  if (whepPathPrefix && clean.startsWith(`${whepPathPrefix}/`)) {
    clean = clean.slice(whepPathPrefix.length + 1);
  }
  return clean;
}

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

app.post('/mediamtx/auth', (req, res) => {
  const body = req.body || {};
  const path = (body.path || '').replace(/^\//, '');
  const sessionId = body.user;
  const roverId = extractRoverId(path);

  if (!sessionId || !roverId) {
    logger.warn('auth missing session or rover (session=%s path=%s)', sessionId, path);
    return res.status(401).end();
  }

  const info = videoSessions.getSession(sessionId);
  if (!info || info.roverId !== roverId) {
    logger.warn('invalid session %s for rover %s', sessionId, roverId);
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
  const role = getRole(socket);
  if (role !== 'spectator' && !isAdmin(socket)) {
    if (!roverManager.isDriver(roverId, socket)) {
      return res.status(401).end();
    }
  }

  return res.status(200).end();
});
