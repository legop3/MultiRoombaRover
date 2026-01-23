function extractForwardedIp(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.split(',')[0].trim();
  }
  if (Array.isArray(value) && value.length) {
    return String(value[0]).trim();
  }
  return null;
}

function getSocketIp(socket) {
  if (!socket) return null;
  const headers = socket.handshake?.headers || {};
  const forwarded = extractForwardedIp(headers['x-forwarded-for']);
  if (forwarded) return forwarded;
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return (
    socket.handshake?.address ||
    socket.conn?.remoteAddress ||
    socket.request?.connection?.remoteAddress ||
    null
  );
}

function getRequestIp(req, override) {
  const fromOverride = extractForwardedIp(override);
  if (fromOverride) return fromOverride;
  if (!req) return null;
  const headers = req.headers || {};
  const forwarded = extractForwardedIp(headers['x-forwarded-for']);
  if (forwarded) return forwarded;
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.ip || req.connection?.remoteAddress || null;
}

module.exports = {
  getSocketIp,
  getRequestIp,
};
