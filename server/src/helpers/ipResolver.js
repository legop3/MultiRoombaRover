const net = require('net');

function extractForwardedIp(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.split(',')[0].trim();
  }
  if (Array.isArray(value) && value.length) {
    return String(value[0]).trim();
  }
  return null;
}

function normalizeIp(value) {
  if (!value) return null;
  let ip = String(value).trim();
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip.includes('%')) {
    ip = ip.split('%')[0];
  }
  return ip.trim() || null;
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  return (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ); // fe80::/10
}

function isLocalNetwork(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const version = net.isIP(normalized);
  if (version === 4) {
    return isPrivateIpv4(normalized);
  }
  if (version === 6) {
    return isPrivateIpv6(normalized);
  }
  return false;
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
  isLocalNetwork,
  normalizeIp,
};
