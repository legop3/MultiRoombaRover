// Video Auth Policy
// Purpose: Encapsulates mode, role, and stream-specific authorization decisions for MediaMTX auth checks.
// Scope: Evaluates viewer/publisher eligibility from normalized request context and socket/session state.
function createVideoAuthPolicy(deps) {
  const {
    getMode,
    MODES,
    isAdmin,
    isLockdownAdmin,
    getRole,
    isVerified,
    turnService,
    roverManager,
    getSocketIp,
    isLocalNetwork,
  } = deps;

  function canView(socket) {
    const mode = getMode();
    if (!socket) return false;
    if (mode === MODES.LOCKDOWN) {
      return isLockdownAdmin(socket);
    }
    if (mode === MODES.ADMIN) {
      const role = getRole(socket);
      return role === 'spectator' || isAdmin(socket);
    }
    return true;
  }

  function canAccessStream({ socket, streamInfo, action, sourceType }) {
    if (!canView(socket)) {
      return false;
    }

    if (streamInfo.type === 'rover') {
      const roverId = streamInfo.baseId || streamInfo.id;
      if (!roverManager.canSeeRover(roverId, socket)) {
        return false;
      }
    }

    if (sourceType === 'roverMic' && action === 'publish') {
      const roverId = streamInfo.baseId || streamInfo.id;
      if (!isVerified(socket)) {
        return false;
      }
      if (!roverManager.isDriver(roverId, socket)) {
        return false;
      }
      if (!turnService.canDrive(roverId, socket)) {
        return false;
      }
      return true;
    }

    const role = getRole(socket);
    const isAudio = streamInfo.id?.endsWith('-audio');
    if (role === 'spectator' && !isAdmin(socket) && !isAudio) {
      const socketIp = getSocketIp(socket);
      if (!isLocalNetwork(socketIp)) {
        return false;
      }
    }

    if (streamInfo.type === 'rover' && role !== 'spectator' && !isAdmin(socket)) {
      const roverId = streamInfo.baseId || streamInfo.id;
      if (!roverManager.isDriver(roverId, socket)) {
        return false;
      }
    }

    return true;
  }

  return {
    canAccessStream,
  };
}

module.exports = {
  createVideoAuthPolicy,
};
