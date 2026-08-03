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

  function forcePublishStreamMode(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    if (!/[?&]streamid=#!::/.test(value)) return value;
    if (/,m=publish\b/.test(value)) return value;
    if (/,m=[a-zA-Z]+\b/.test(value)) return value.replace(/,m=[a-zA-Z]+\b/, ',m=publish');
    return value.replace(/([?&]streamid=#!::[^&]*)/, '$1,m=publish');
  }

  /*
    Where and how the server publishes forwarded audio into MediaMTX.

    Measured on the server-originated path (bonk sound, VIP clip playback, forwarded TTS),
    server publish through to rover PCM:

      publish mpegts, rover reads srt    283ms    <- current
      publish mpegts, rover reads rtsp   168ms
      publish rtsp,   rover reads srt    151.5ms
      publish rtsp,   rover reads rtsp    30.5ms

    This is the only audio path with MPEG-TS on both legs, so it pays the container cost twice
    where the browser microphone pays it once. The two legs are roughly additive at ~115ms and
    ~131ms.

    RTSP is used only when the rover has an rtspUrl configured, because the rover has to be
    able to read what is published. An absent rtspUrl therefore keeps exactly today's
    behaviour, and the two legs can be migrated independently in either order - each one alone
    still helps.
  */
  function resolveForwardPublishTarget(roverId) {
    const record = roverManager.rovers.get(roverId);
    const rtspUrl = record?.meta?.media?.audioPlayback?.rtspUrl;
    if (rtspUrl && String(rtspUrl).trim()) {
      /*
        No mode rewriting for RTSP. SRT distinguishes publish from read inside the stream id,
        which is why forcePublishStreamMode exists; RTSP distinguishes them by method
        (ANNOUNCE/RECORD versus DESCRIBE/PLAY), so the same URL serves both.
      */
      return { url: String(rtspUrl).trim(), container: 'rtsp' };
    }
    return { url: resolveForwardUrl(roverId), container: 'mpegts' };
  }

  function resolveForwardUrl(roverId) {
    const record = roverManager.rovers.get(roverId);
    // Rovers listen to the playback stream with a request/read URL. The VIP
    // upload path needs to publish into that same stream, so the configured
    // nested playback URL is converted to publish mode below.
    const configured = record?.meta?.media?.audioPlayback?.forwardUrl;
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
    resolveForwardPublishTarget,
    resolveForwardPathId,
    buildWhipUrl,
  };
}

module.exports = {
  createAudioForwardPolicy,
};
