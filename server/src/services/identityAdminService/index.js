// Identity Admin Service
// Purpose: Exposes lockdown admin socket operations for inspecting and editing the central identity database.
// Scope: Owns transport-level authorization and delegates every database mutation to identityService.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('identityAdminService');
const { getRole } = require('../roleService');
const {
  listUsersForAdmin,
  getUserForAdmin,
  addUserSignal,
  removeUserSignal,
  setVerified,
  setDeterrence,
  setFeatureState,
  deleteFeatureState,
} = require('../identityService');

const MAX_FEATURE_STATE_JSON_BYTES = 64 * 1024;

function isLockdownAdminSocket(socket) {
  const role = getRole(socket);
  return role === 'lockdown';
}

function requireLockdownAdmin(socket) {
  if (!isLockdownAdminSocket(socket)) {
    throw new Error('Lockdown admin required.');
  }
}

function normalizeFeaturePayload(namespace, value) {
  const ns = String(namespace || '').trim();
  if (!ns) throw new Error('Feature namespace required.');
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(ns)) {
    throw new Error('Feature namespace contains invalid characters.');
  }

  /*
    Feature state is intentionally JSON-shaped. Strings are not accepted as the
    stored value because they make the admin editor ambiguous: a textarea JSON
    string should represent a real JSON object/array, not an escaped blob.
  */
  if (!value || typeof value !== 'object') {
    throw new Error('Feature state must be a JSON object or array.');
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_FEATURE_STATE_JSON_BYTES) {
    throw new Error('Feature state is too large.');
  }
  return { namespace: ns, value };
}

function ackHandler(socket, eventName, handler) {
  socket.on(eventName, (payload = {}, cb = () => {}) => {
    try {
      requireLockdownAdmin(socket);
      cb({ success: true, ...handler(payload || {}) });
    } catch (err) {
      logger.warn('Identity admin request failed', {
        eventName,
        socketId: socket.id,
        role: getRole(socket),
        error: err.message,
      });
      cb({ error: err.message });
    }
  });
}

io.on('connection', (socket) => {
  ackHandler(socket, 'identityAdmin:listUsers', () => ({
    users: listUsersForAdmin(),
  }));

  ackHandler(socket, 'identityAdmin:getUser', ({ userId }) => {
    const user = getUserForAdmin(userId);
    if (!user) throw new Error('User not found.');
    return { user };
  });

  ackHandler(socket, 'identityAdmin:addSignal', ({ userId, type, value }) => ({
    user: addUserSignal(userId, type, value),
  }));

  ackHandler(socket, 'identityAdmin:removeSignal', ({ userId, type, value }) => ({
    user: removeUserSignal(userId, type, value),
  }));

  ackHandler(socket, 'identityAdmin:setVerified', ({ userId, enabled }) => ({
    user: getUserForAdmin(setVerified(userId, {
      enabled: Boolean(enabled),
      actor: socket?.data?.user?.username || socket.id,
      at: Date.now(),
    }).id),
  }));

  ackHandler(socket, 'identityAdmin:setDeterrence', ({ userId, enabled, reason }) => ({
    user: getUserForAdmin(setDeterrence(userId, {
      enabled: Boolean(enabled),
      reason: String(reason || '').trim() || null,
      actor: socket?.data?.user?.username || socket.id,
      at: Date.now(),
    }).id),
  }));

  ackHandler(socket, 'identityAdmin:updateFeatureState', ({ userId, namespace, value }) => {
    const normalized = normalizeFeaturePayload(namespace, value);
    setFeatureState(userId, normalized.namespace, normalized.value);
    return { user: getUserForAdmin(userId) };
  });

  ackHandler(socket, 'identityAdmin:deleteFeatureState', ({ userId, namespace }) => ({
    user: deleteFeatureState(userId, namespace),
  }));
});

module.exports = {
  isLockdownAdminSocket,
};
