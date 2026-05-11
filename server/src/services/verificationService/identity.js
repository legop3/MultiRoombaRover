// Verification Identity Helpers
// Purpose: Centralizes socket identity extraction and normalization for verification/moderation decisions.
// Scope: Keeps role checks and selector normalization consistent across all verification-service flows.
const net = require('net');
const { normalizeIp } = require('../../helpers/ipResolver');
const { getNickname } = require('../nicknameService');
const {
  sanitizeNickname,
  normalizeCookieUserId,
  isValidCookieUserId,
  generateCookieUserId,
  getKnownIp,
} = require('../identityService');

function ensureSocketData(socket) {
  socket.data = socket.data || {};
  return socket.data;
}

function identityFromSocket(socket) {
  const data = ensureSocketData(socket);
  return {
    cookieUserId: normalizeCookieUserId(data.cookieUserId),
    nickname: sanitizeNickname(getNickname(socket)),
    ip: getKnownIp(socket),
  };
}

function normalizeNicknameKey(value) {
  return sanitizeNickname(value).toLowerCase();
}

function normalizeKnownIps(raw = []) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((value) => {
    const ip = typeof value === 'string' ? value.trim() : '';
    if (!ip) return;
    if (!out.includes(ip)) {
      out.push(ip);
    }
  });
  return out;
}

function isAdminRole(role) {
  return role === 'admin' || role === 'lockdown';
}

function parseDeterrenceSelector(selector) {
  const value = String(selector || '').trim();
  if (!value) {
    throw new Error('Selector required.');
  }
  const cookie = normalizeCookieUserId(value);
  if (cookie && isValidCookieUserId(cookie)) {
    return { cookieUserId: cookie, nickname: '', ip: null };
  }
  const ip = normalizeIp(value);
  if (ip && net.isIP(ip)) {
    return { cookieUserId: '', nickname: '', ip };
  }
  const nickname = sanitizeNickname(value);
  if (!nickname) {
    throw new Error('Selector required.');
  }
  return { cookieUserId: '', nickname, ip: null };
}

function isRawIp(value) {
  const ip = typeof value === 'string' ? value.trim() : '';
  return Boolean(ip && net.isIP(ip));
}

module.exports = {
  ensureSocketData,
  identityFromSocket,
  normalizeNicknameKey,
  normalizeKnownIps,
  isAdminRole,
  parseDeterrenceSelector,
  isRawIp,
  normalizeCookieUserId,
  isValidCookieUserId,
  generateCookieUserId,
  sanitizeNickname,
};
