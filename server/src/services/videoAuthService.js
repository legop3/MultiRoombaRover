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
const whepPrefixSegments = whepPathPrefix ? whepPathPrefix.split('/').filter(Boolean) : [];

function extractStreamInfo(path) {
  const segments = (path || '').split('/').filter(Boolean);
  if (!segments.length) {
    return null;
  }

  let start = 0;
  if (
    whepPrefixSegments.length &&
    whepPrefixSegments.every((segment, idx) => segments[idx] === segment)
  ) {
    start = whepPrefixSegments.length;
  }

  let end = segments.length;
  if (segments[end - 1] === 'whep') {
    end -= 1;
  }

  const remaining = segments.slice(start, end);
  if (remaining.length === 1) {
    const rawId = remaining[0] || '';
    const baseId = rawId.endsWith('-audio') ? rawId.slice(0, -6) : rawId;
    return { type: 'rover', id: rawId, baseId };
  }
  if (remaining.length === 2 && remaining[0] === 'room') {
    return { type: 'room', id: remaining[1] || '' };
  }
  return null;
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
    const role = getRole(socket);
    return role === 'spectator' || isAdmin(socket);
  }
  return true;
}

app.post('/mediamtx/auth', (req, res) => {
  const body = req.body || {};
  const path = (body.path || '').replace(/^\//, '');
  const sessionId = body.user;
  const streamInfo = extractStreamInfo(path);

  logger.info('video auth request', { path: body.path, sessionId, stream: streamInfo });

  if (!sessionId || !streamInfo?.id) {
    logger.warn('auth missing session or stream (session=%s path=%s)', sessionId, path);
    return res.status(401).end();
  }

  const info = videoSessions.getSession(sessionId);
  if (!info || info.sourceType !== streamInfo.type || info.sourceId !== streamInfo.id) {
    logger.warn('invalid session %s for stream %s:%s', sessionId, streamInfo.type, streamInfo.id);
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
  if (streamInfo.type === 'rover' && role !== 'spectator' && !isAdmin(socket)) {
    const roverId = streamInfo.baseId || streamInfo.id;
    if (!roverManager.isDriver(roverId, socket)) {
      return res.status(401).end();
    }
  }

  return res.status(200).end();
});
