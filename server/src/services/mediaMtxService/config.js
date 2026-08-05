// MediaMTX Config Builder
// Purpose: Converts the rover server's media settings into the complete MediaMTX runtime configuration.
// Scope: Keeps deployment-specific hosts in config.yaml while keeping protocol policy owned by the application.
const path = require('path');

function normalizeAdditionalHosts(rawHosts) {
  if (rawHosts == null) return [];
  if (!Array.isArray(rawHosts)) {
    throw new Error('media.additionalHosts must be a list');
  }

  /*
    MediaMTX accepts both IP addresses and DNS names here. Preserve that flexibility because
    an installation can need a public candidate and a LAN candidate at the same time. Empty
    entries and duplicates are removed so a harmless config typo does not create redundant
    ICE candidates, while the values themselves remain entirely instance-owned.
  */
  return [...new Set(rawHosts.map((value) => String(value || '').trim()).filter(Boolean))];
}

function buildMediaMtxConfig({ config, serverPort, snapshotWriterPath }) {
  const media = config?.media || {};
  let additionalHosts = normalizeAdditionalHosts(media.additionalHosts);
  if (!additionalHosts.length && media.whepBaseUrl) {
    try {
      /*
        Existing installations predate media.additionalHosts. Using the already-configured
        WHEP hostname as a one-host migration default keeps them reachable on first restart;
        administrators can still list every public and LAN candidate explicitly afterward.
      */
      additionalHosts = [new URL(media.whepBaseUrl).hostname].filter(Boolean);
    } catch {
      throw new Error('media.whepBaseUrl must be a valid URL when media.additionalHosts is empty');
    }
  }
  const authPort = Number(serverPort) || 8080;

  return {
    logLevel: 'info',
    api: true,
    apiAddress: '127.0.0.1:9997',
    metrics: true,
    metricsAddress: '127.0.0.1:9998',
    pprof: false,
    pprofAddress: '127.0.0.1:9999',

    /*
      Rover publishers and readers always request TCP explicitly. Declaring only TCP here
      also prevents MediaMTX from opening the separate RTP/RTCP UDP listeners, which are not
      useful for this local-network deployment and performed poorly in the measured tests.
    */
    rtsp: true,
    rtspAddress: ':8554',
    rtspTransports: ['tcp'],
    rtmp: false,
    hls: false,

    webrtc: true,
    webrtcLocalUDPAddress: ':8189',
    webrtcLocalTCPAddress: ':8189',
    webrtcAdditionalHosts: additionalHosts,
    webrtcICEServers2: [
      { url: 'stun:stun.l.google.com:19302' },
      { url: 'stun:stun1.l.google.com:19302' },
      { url: 'stun:stun2.l.google.com:19302' },
      { url: 'stun:stun3.l.google.com:19302' },
      { url: 'stun:stun4.l.google.com:19302' },
      { url: 'stun:stun.cloudflare.com:3478' },
    ],

    /*
      Several server-local paths still use SRT: PTZ publishing, replay capture, and the snapshot
      writer. Rover media moves to RTSP, but removing this listener would break those independent
      consumers, so both listeners remain deliberately enabled.
    */
    srt: true,
    srtAddress: ':9000',

    authMethod: 'http',
    authHTTPAddress: `http://127.0.0.1:${authPort}/mediamtx/auth`,
    authHTTPExclude: [
      { action: 'api' },
      { action: 'metrics' },
      { action: 'pprof' },
    ],
    paths: {
      all: {
        source: 'publisher',
        sourceOnDemand: false,
        runOnReady: path.resolve(snapshotWriterPath),
        runOnReadyRestart: true,
      },
    },
  };
}

module.exports = {
  buildMediaMtxConfig,
  normalizeAdditionalHosts,
};
