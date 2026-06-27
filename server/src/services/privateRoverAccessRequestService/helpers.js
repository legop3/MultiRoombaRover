// Private Rover Access Helpers
// Purpose: Provides normalization, keying, lookup, and rover-list helpers used by request/grant workflows.
// Scope: Keeps pure or low-side-effect utility behavior centralized and reusable across modules.
const io = require('../../globals/io');
const roverManager = require('../roverManager');
const { normalizeCookieUserId } = require('../identityService');

function normalizeRoverId(value) {
  return String(value || '').trim();
}

function buildRequesterKey(socket) {
  const userId = String(socket?.data?.userId || '').trim();
  if (userId) return `user:${userId}`;
  const cookieUserId = normalizeCookieUserId(socket?.data?.cookieUserId);
  if (cookieUserId) return `cookie:${cookieUserId}`;
  return `socket:${socket?.id || 'unknown'}`;
}

function normalizeRequesterKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildGrantKey(requesterKey, roverId) {
  return `${normalizeRequesterKey(requesterKey)}:${normalizeRoverId(roverId)}`;
}

function isClosedPrivateRoverRecord(record) {
  return Boolean(record?.private?.enabled && !record?.privateOpen);
}

function listClosedPrivateRovers() {
  return Array.from(roverManager.rovers.values())
    .filter((record) => isClosedPrivateRoverRecord(record))
    .map((record) => ({
      id: String(record.id),
      name: record.meta?.name || record.id,
      color: record.meta?.color || null,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function getSocketByRequesterKey(requesterKey) {
  if (!requesterKey) return null;
  if (requesterKey.startsWith('socket:')) {
    const socketId = requesterKey.slice('socket:'.length);
    return io.sockets.sockets.get(socketId) || null;
  }
  if (requesterKey.startsWith('user:')) {
    const userId = requesterKey.slice('user:'.length);
    for (const socket of io.sockets.sockets.values()) {
      if (String(socket?.data?.userId || '').trim() === userId) {
        return socket;
      }
    }
  }
  if (requesterKey.startsWith('cookie:')) {
    const cookieUserId = requesterKey.slice('cookie:'.length);
    for (const socket of io.sockets.sockets.values()) {
      const key = normalizeCookieUserId(socket?.data?.cookieUserId);
      if (key && key === cookieUserId) {
        return socket;
      }
    }
  }
  return null;
}

module.exports = {
  normalizeRoverId,
  buildRequesterKey,
  normalizeRequesterKey,
  buildGrantKey,
  listClosedPrivateRovers,
  getSocketByRequesterKey,
};
