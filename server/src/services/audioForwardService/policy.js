// audio Forward Service policy
// Purpose: Encapsulates permission checks and media path/url derivation helpers.
// Scope: Keeps runtime behavior unchanged while isolating validation and path-construction logic.
function createAudioForwardPolicy(deps) {
  const {
    isVerified,
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
    if (!roverManager.isDriver(roverId, socket)) {
      throw new Error('Audio forwarding is only allowed on your own rover');
    }
    if (!turnService.canDrive(roverId, socket)) {
      throw new Error('Only the current driver can play audio');
    }
  }

  function forcePublishStreamMode(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    if (!/[?&]streamid=#!::/.test(value)) return value;
    if (/,m=publish\b/.test(value)) return value;
    if (/,m=[a-zA-Z]+\b/.test(value)) return value.replace(/,m=[a-zA-Z]+\b/, ',m=publish');
    return value.replace(/([?&]streamid=#!::[^&]*)/, '$1,m=publish');
  }

  function resolveForwardUrl(roverId) {
    const record = roverManager.rovers.get(roverId);
    const configured = record?.meta?.media?.audioForwardUrl;
    if (configured) return forcePublishStreamMode(configured);
    return `srt://127.0.0.1:9000?streamid=#!::r=${encodeURIComponent(
      roverId + streamSuffix,
    )},m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316`;
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
