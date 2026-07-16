// Video Auth Policy
// Purpose: Encapsulates mode, role, and stream-specific authorization decisions for MediaMTX auth checks.
// Scope: Evaluates viewer/publisher eligibility from normalized request context and socket/session state.
const {
  shouldUseSnapshotsForNonTurnVideo,
  shouldUseSnapshotsForExternalSpectatorVideo,
} = require('../../helpers/bandwidthSavings');

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
    ptzCameraService,
    getSocketIp,
    isLocalNetwork,
    io,
  } = deps;

  function countControllableUsers() {
    const ids = new Set();
    io.sockets.sockets.forEach((candidate) => {
      if (!candidate?.id || getRole(candidate) === 'spectator') return;
      /*
        MediaMTX can ask for authorization after a browser has already received
        a token, so this count intentionally mirrors videoSocketService instead
        of trusting the client-visible session policy snapshot.
      */
      if (roverManager.getRoversForSocket(candidate.id).length > 0) {
        ids.add(candidate.id);
      }
    });
    if (typeof ptzCameraService.getParticipantSocketIds === 'function') {
      ptzCameraService.getParticipantSocketIds().forEach((socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && getRole(socket) !== 'spectator') ids.add(socketId);
      });
    }
    return ids.size;
  }

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

    if (streamInfo.type === 'ptz') {
      return ptzCameraService.canRequestLiveVideo(socket);
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
      if (!isLocalNetwork(socketIp) && shouldUseSnapshotsForExternalSpectatorVideo()) {
        return false;
      }
    }

    if (streamInfo.type === 'rover' && role !== 'spectator' && !isAdmin(socket)) {
      const roverId = streamInfo.baseId || streamInfo.id;
      if (!roverManager.isDriver(roverId, socket)) {
        return false;
      }
      if (
        !isAudio &&
        shouldUseSnapshotsForNonTurnVideo({ controllableUserCount: countControllableUsers() }) &&
        !turnService.canDrive(roverId, socket)
      ) {
        /*
          This mirrors videoSocketService's token gate. MediaMTX can ask auth
          after a token has been issued, so the active-turn bandwidth rule must
          be evaluated here too instead of trusting an older browser decision.
        */
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
