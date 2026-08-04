// audio Forward Service policy
// Purpose: Encapsulates permission checks and media path/url derivation helpers.
// Scope: Keeps runtime behavior unchanged while isolating validation and path-construction logic.
function createAudioForwardPolicy(deps) {
  const {
    isVerified,
    isMuted,
    roverManager,
    turnService,
    streamSuffix,
    mediaConfig,
  } = deps;

  function ensureVipVerified(socket) {
    if (!isVerified(socket)) {
      throw new Error('VIP verification required');
    }
  }

  function ensureAudioForwardPermission(socket, roverId) {
    ensureVipVerified(socket);
    if (isMuted(socket)) {
      throw new Error('Muted');
    }
    if (!roverManager.isDriver(roverId, socket)) {
      throw new Error('Audio forwarding is only allowed on your own rover');
    }
    if (!turnService.canDrive(roverId, socket)) {
      throw new Error('Only the current driver can play audio');
    }
  }

  function resolveForwardUrl(roverId) {
    /*
      The server publishes to its own MediaMTX child, so loopback is the stable and correct
      route regardless of which hostname a rover uses to reach this machine. RTSP uses the
      same path for publish and read; ANNOUNCE/RECORD and DESCRIBE/PLAY distinguish direction.
    */
    return `rtsp://127.0.0.1:8554/${encodeURIComponent(roverId + streamSuffix)}`;
  }

  function resolveForwardPathId(roverId) {
    return `${roverId}${streamSuffix}`;
  }

  function getMediaPrefix() {
    const base = mediaConfig.whepBaseUrl;
    if (!base) return '';
    try {
      const parsed = new URL(base);
      return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    } catch {
      return String(base).replace(/\/+$/, '');
    }
  }

  function buildWhipUrl(pathId) {
    const prefix = getMediaPrefix();
    if (!prefix) {
      throw new Error('Server media base URL missing');
    }
    return `${prefix}/${encodeURIComponent(pathId)}/whip`;
  }

  return {
    ensureVipVerified,
    ensureAudioForwardPermission,
    resolveForwardUrl,
    resolveForwardPathId,
    buildWhipUrl,
  };
}

module.exports = {
  createAudioForwardPolicy,
};
