// rover Manager private access
// Purpose: Encapsulates private-rover visibility and control-authorization policy checks.
// Scope: Keeps runtime behavior unchanged while isolating policy decisions from orchestration wiring.
function createPrivateAccessPolicy(deps) {
  const {
    io,
    turnService,
    MODES,
    getMode,
    isAdmin,
    isLockdownAdmin,
    normalizePrivateSafety,
    DEFAULT_PRIVATE_SAFETY,
  } = deps;

  function parsePrivateMeta(meta = {}) {
    const raw = meta?.private;
    if (raw === true) {
      return { enabled: true, safety: { ...DEFAULT_PRIVATE_SAFETY } };
    }
    if (!raw || typeof raw !== 'object') {
      return { enabled: false, safety: { ...DEFAULT_PRIVATE_SAFETY } };
    }
    const safety = normalizePrivateSafety(raw.safety || {});
    return {
      enabled: Boolean(raw.enabled),
      safety,
    };
  }

  function isPrivateRecord(record) {
    return Boolean(record?.private?.enabled);
  }

  function isPrivateOpen(record) {
    if (!isPrivateRecord(record)) return true;
    return Boolean(record?.privateOpen);
  }

  function getPrivateSafety(record) {
    if (!record) return { ...DEFAULT_PRIVATE_SAFETY };
    return normalizePrivateSafety(record.privateSafety || record.private?.safety || {});
  }

  function shouldApplyPrivateSafety(record, socket) {
    if (!isPrivateRecord(record)) return false;
    if (isLockdownAdmin(socket)) return false;
    return true;
  }

  function shouldApplyPrivateSensorSafety(record) {
    if (!isPrivateRecord(record)) return false;
    const activeDrivers = turnService.getActiveDrivers();
    const activeDriverId = activeDrivers?.[record.id];
    if (!activeDriverId) return false;
    const activeSocket = io.sockets.sockets.get(activeDriverId);
    if (!activeSocket) return true;
    return !isLockdownAdmin(activeSocket);
  }

  function socketHasClosedPrivateAccess(socket, roverId) {
    const list = Array.isArray(socket?.data?.privateClosedAccessRovers)
      ? socket.data.privateClosedAccessRovers
      : [];
    return list.some((id) => String(id) === String(roverId));
  }

  function isRoverVisibleToSocket(record, socket) {
    if (!record) return false;
    if (!isPrivateRecord(record)) return true;
    if (isPrivateOpen(record)) return true;
    if (isLockdownAdmin(socket)) return true;
    return socketHasClosedPrivateAccess(socket, record.id);
  }

  function getControlDenialReason(record, socket, options = {}) {
    const { allowUser = false } = options;
    if (!record) return 'Unknown rover';
    if (!allowUser && !isAdmin(socket)) return 'Only admins can request control';
    if (record.locked && !isAdmin(socket)) return 'Rover locked';
    const mode = getMode();
    if (!allowUser && mode === MODES.ADMIN && !isAdmin(socket)) return 'Admins only';
    if (!allowUser && mode === MODES.LOCKDOWN && !isLockdownAdmin(socket)) return 'Server in lockdown';
    if (mode === MODES.LOCKDOWN && !isLockdownAdmin(socket)) return 'Server in lockdown';
    const { isDeterred } = require('../verificationService');
    if (!isAdmin(socket) && isDeterred(socket)) return 'Not authorized';
    if (!isPrivateRecord(record)) return null;
    if (!isPrivateOpen(record)) {
      if (!isLockdownAdmin(socket)) {
        if (socketHasClosedPrivateAccess(socket, record.id)) return null;
        return 'Private rover is closed';
      }
      return null;
    }
    if (isLockdownAdmin(socket)) return null;
    const { isVerified } = require('../verificationService');
    if (!isVerified(socket)) return 'Private rover requires verification';
    return null;
  }

  return {
    parsePrivateMeta,
    isPrivateRecord,
    isPrivateOpen,
    getPrivateSafety,
    shouldApplyPrivateSafety,
    shouldApplyPrivateSensorSafety,
    socketHasClosedPrivateAccess,
    isRoverVisibleToSocket,
    getControlDenialReason,
  };
}

module.exports = {
  createPrivateAccessPolicy,
};
