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
    const normalized = value
      /*
        A literal "#" inside the SRT stream ID turns the rest of the URL into a
        fragment for normal URL parsers. Encoding the "#!" prefix keeps MediaMTX
        receiving the same stream ID while allowing latency/mode/transtype to be
        parsed as real SRT options instead of being accidentally hidden inside
        the stream ID text.
      */
      .replace(/([?&]streamid=)#!::/, '$1%23%21::')
      /*
        SRT latency is expressed in microseconds by ffmpeg/libsrt. The previous
        latency=10 value was both too small to be a sane target and, because of
        the unescaped stream ID, was not being applied in practice. Use the same
        20 ms target as rover publishing.
      */
      .replace(/([?&]latency=)10\b/, (_, prefix) => `${prefix}20000`);
    if (!/[?&]streamid=(?:#!::|%23%21::)/.test(normalized)) return normalized;
    if (/,m=publish\b/.test(normalized)) return normalized;
    if (/,m=[a-zA-Z]+\b/.test(normalized)) return normalized.replace(/,m=[a-zA-Z]+\b/, ',m=publish');
    return normalized.replace(/([?&]streamid=(?:#!::|%23%21::)[^&]*)/, '$1,m=publish');
  }

  function resolveForwardUrl(roverId) {
    const record = roverManager.rovers.get(roverId);
    const configured = record?.meta?.media?.audioForwardUrl;
    if (configured) return forcePublishStreamMode(configured);
    return `srt://127.0.0.1:9000?streamid=%23%21::r=${encodeURIComponent(
      roverId + streamSuffix,
    )},m=publish&latency=20000&mode=caller&transtype=live&pkt_size=1316`;
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
