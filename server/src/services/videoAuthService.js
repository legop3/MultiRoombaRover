const { app } = require('../globals/http');
const io = require('../globals/io');
const logger = require('../globals/logger').child('videoAuth');
const videoSessions = require('./videoSessions');
const { getMode, MODES } = require('./modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('./roleService');
const roverManager = require('./roverManager');
const { loadConfig } = require('../helpers/configLoader');
const { getRequestIp, getSocketIp, isLocalNetwork } = require('../helpers/ipResolver');
const { logAdminEvent } = require('./adminLogService');

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

function extractSrtStreamId(rawValue) {
  const value = decodeURIComponent(String(rawValue || '').trim());
  if (!value) return '';

  // streamid may be passed as the full value or as query text.
  const match = value.match(/(?:^|[?&]|,|#!::)r=([^,&]+)/);
  if (match?.[1]) {
    return match[1];
  }

  // Fallback: treat plain token as stream id when no separators are present.
  if (!/[?&=,:]/.test(value)) {
    return value;
  }
  return '';
}

function extractStreamInfoFromBody(body = {}) {
  const fromPath = extractStreamInfo((body.path || '').replace(/^\//, ''));
  if (fromPath) return fromPath;

  const srtId =
    extractSrtStreamId(body.streamid) ||
    extractSrtStreamId(body.streamId) ||
    extractSrtStreamId(body.query);
  if (!srtId) return null;

  const baseId = srtId.endsWith('-audio') ? srtId.slice(0, -6) : srtId;
  return { type: 'rover', id: srtId, baseId };
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
  const action = (body.action || '').toLowerCase();
  const protocol = (body.protocol || '').toLowerCase();
  const ip = getRequestIp(req, body.ip);
  const streamInfo = extractStreamInfoFromBody(body);

  logger.info('video auth request', { path: body.path, sessionId, stream: streamInfo, action, protocol });
  if (ip) {
    logAdminEvent({
      label: 'mediamtx',
      message: 'Media auth request',
      ip,
      meta: { path: body.path, sessionId, stream: streamInfo, action, protocol },
    });
  }

  // Rover forward-listener uses SRT read without session tokens; allow these reads.
  if (action === 'read' && protocol === 'srt') {
    return res.status(200).end();
  }

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
  const isAudio = streamInfo.id?.endsWith('-audio');
  if (role === 'spectator' && !isAdmin(socket) && !isAudio) {
    const socketIp = getSocketIp(socket);
    if (!isLocalNetwork(socketIp)) {
      return res.status(401).end();
    }
  }
  if (streamInfo.type === 'rover' && role !== 'spectator' && !isAdmin(socket)) {
    const roverId = streamInfo.baseId || streamInfo.id;
    if (!roverManager.isDriver(roverId, socket)) {
      return res.status(401).end();
    }
  }

  return res.status(200).end();
});
