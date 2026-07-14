// auth Service
// Purpose: Defines the auth Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const bcrypt = require('bcrypt');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('authService');
const { loadConfig } = require('../../helpers/configLoader');
const { clearLockdownTimer } = require('../lockdownGuard');
const { getMode, MODES } = require('../modeManager');
const { setRole } = require('../roleService');
const { getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');
const {
  canUseExternalSpectatorAccess,
  getBandwidthSavingsPolicy,
} = require('../../helpers/bandwidthSavings');
const {
  getFeatureState,
  getUserIdForSocket,
} = require('../identityService');

const config = loadConfig();
const admins = config.admins || [];
const SPECTATOR_ACCESS_NAMESPACE = 'spectatorAccess';

function findAdmin(username) {
  return admins.find((admin) => admin.username === username);
}

async function authenticate(username, password) {
  const admin = findAdmin(username);
  if (!admin) {
    throw new Error('Invalid credentials');
  }
  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) {
    throw new Error('Invalid credentials');
  }
  return admin;
}

function isAdmin(socket) {
  return socket?.data?.role === 'admin' || socket?.data?.role === 'lockdown';
}

function isLockdownAdmin(socket) {
  return socket?.data?.role === 'lockdown';
}

function hasExternalSpectatorGrant(socket) {
  const userId = getUserIdForSocket(socket);
  if (!userId) return false;
  const state = getFeatureState(userId, SPECTATOR_ACCESS_NAMESPACE, {});
  /*
    The identity database already owns per-user feature state. Keeping the grant
    as a tiny namespaced boolean avoids a new table and lets the existing admin
    database editor grant/revoke external spectator access immediately.
  */
  return Boolean(state?.external);
}

function canBecomeSpectator(socket) {
  const ip = getSocketIp(socket);
  const local = isLocalNetwork(ip);
  return canUseExternalSpectatorAccess({
    isLocal: local,
    isAdmin: isAdmin(socket),
    hasGrant: hasExternalSpectatorGrant(socket),
  });
}

function externalSpectatorAccessError() {
  const mode = getBandwidthSavingsPolicy().externalSpectatorAccess;
  if (mode === 'admin') {
    return 'External spectator access requires admin approval for this identity.';
  }
  return 'External spectator access is disabled.';
}

io.on('connection', (socket) => {
  const requestedRole = socket.handshake?.query?.role;
  /*
    Role is assigned before the browser's full identity heartbeat has completed.
    For admin-gated external spectators, fail closed here; the spectator page can
    identify the socket and then retry session:setRole once the grant exists.
  */
  const initialRole = requestedRole === 'spectator' && canBecomeSpectator(socket) ? 'spectator' : 'user';
  setRole(socket, initialRole);
  logger.info('Socket connected with role', socket.id, initialRole);
  socket.emit('auth:role', { role: initialRole });
  socket.on('auth:login', async ({ username, password }, cb = () => {}) => {
    try {
      const admin = await authenticate(username, password);
      if (getMode() === MODES.LOCKDOWN && !admin.lockdown) {
        throw new Error('Lockdown admins only');
      }
      const role = admin.lockdown ? 'lockdown' : 'admin';
      socket.data.user = { username: admin.username, discordId: admin.discord_id };
      setRole(socket, role);
      socket.emit('auth:role', { role });
      clearLockdownTimer(socket);
      logger.info('Login success', socket.id, role);
      cb({ success: true, role: socket.data.role });
    } catch (err) {
      logger.warn('Login failed', socket.id, err.message);
      cb({ success: false, error: err.message });
    }
  });

  function handleRoleChange({ role } = {}, cb = () => {}) {
    if (role === 'spectator' || role === 'user') {
      if (role === 'spectator' && !canBecomeSpectator(socket)) {
        const error = externalSpectatorAccessError();
        logger.info('Spectator role denied by bandwidth policy', socket.id, { error });
        cb({ error });
        return;
      }
      setRole(socket, role);
      socket.emit('auth:role', { role });
      logger.info('Role changed via client request', socket.id, role);
      cb({ success: true, role });
    } else {
      cb({ error: 'Invalid role' });
    }
  }

  socket.on('role:set', handleRoleChange);
  socket.on('session:setRole', handleRoleChange);
});

module.exports = {
  isAdmin,
  isLockdownAdmin,
  authenticate,
};
