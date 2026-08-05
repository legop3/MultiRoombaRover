// Video Auth HTTP Route
// Purpose: Wires the MediaMTX auth endpoint to session validation, audit logging, and policy checks.
// Scope: Handles request transport and token/session lookup while delegating stream parsing and auth decisions.
function registerVideoAuthRoute(deps) {
  const {
    app,
    io,
    logger,
    videoSessions,
    getRequestIp,
    logAdminEvent,
    extractStreamInfoFromBody,
    canAccessStream,
  } = deps;

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

    const isSrtLikeProtocol = protocol === 'srt' || protocol === 'srtconn' || protocol.startsWith('srt');
    const isRtspProtocol = protocol === 'rtsp' || protocol.startsWith('rtsp');
    const isForwardAudioRead = action === 'read' && streamInfo?.id?.endsWith('-fwd');
    if ((action === 'read' && isSrtLikeProtocol) || isForwardAudioRead) {
      return res.status(200).end();
    }
    if (action === 'publish' && isSrtLikeProtocol) {
      return res.status(200).end();
    }
    /*
      Rover and server publishers reach MediaMTX only on the local network and intentionally
      do not carry browser session credentials. MediaMTX still invokes its global HTTP auth
      callback for RTSP, so explicitly admit that publish protocol while leaving WHEP reads
      under the existing session and role checks below.
    */
    if (action === 'publish' && isRtspProtocol) {
      return res.status(200).end();
    }

    if (!sessionId || !streamInfo?.id) {
      logger.warn('auth missing session or stream (session=%s path=%s)', sessionId, path);
      return res.status(401).end();
    }

    const info = videoSessions.getSession(sessionId);
    const streamTypeMatches =
      info &&
      (info.sourceType === streamInfo.type || (info.sourceType === 'roverMic' && streamInfo.type === 'rover'));
    if (!info || !streamTypeMatches || info.sourceId !== streamInfo.id) {
      logger.warn('invalid session %s for stream %s:%s', sessionId, streamInfo.type, streamInfo.id);
      return res.status(401).end();
    }

    const socket = io.sockets.sockets.get(info.socketId);
    if (!socket) {
      videoSessions.revokeSession(sessionId);
      return res.status(401).end();
    }

    if (!canAccessStream({ socket, streamInfo, action, sourceType: info.sourceType })) {
      return res.status(401).end();
    }

    return res.status(200).end();
  });
}

module.exports = {
  registerVideoAuthRoute,
};
