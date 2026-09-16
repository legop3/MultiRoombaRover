// MediaMTX HTTP Proxy
// Purpose: Exposes WHEP and WHIP signaling beneath the server-owned /video path while MediaMTX remains loopback-only.
// Scope: Proxies signaling HTTP only; WebRTC media continues to travel directly through MediaMTX's ICE listener.
const { createProxyMiddleware } = require('http-proxy-middleware');

const PUBLIC_MEDIA_PREFIX = '/video';
const INTERNAL_WEBRTC_ORIGIN = 'http://127.0.0.1:8889';
const SIGNALING_TIMEOUT_MS = 60 * 60 * 1000;

function rewriteSessionLocation(location, internalOrigin = INTERNAL_WEBRTC_ORIGIN) {
  const value = String(location || '');
  if (!value) return value;

  /*
    MediaMTX normally returns a root-relative WHEP/WHIP session URL. Browsers
    subsequently PATCH and DELETE that exact Location, so restore the public
    mount prefix that was removed before proxying the initial request.
  */
  if (value.startsWith('/') && !value.startsWith(`${PUBLIC_MEDIA_PREFIX}/`)) {
    return `${PUBLIC_MEDIA_PREFIX}${value}`;
  }

  try {
    const parsed = new URL(value);
    if (parsed.origin === new URL(internalOrigin).origin) {
      return `${PUBLIC_MEDIA_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // A path relative to the WHEP/WHIP endpoint already resolves beneath
    // /video in the browser and must not be converted into a root path.
  }
  return value;
}

function createMediaMtxProxy({ target = INTERNAL_WEBRTC_ORIGIN, logger = console } = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: SIGNALING_TIMEOUT_MS,
    timeout: SIGNALING_TIMEOUT_MS,
    logger,
    on: {
      proxyRes(proxyResponse) {
        const location = proxyResponse.headers.location;
        if (location) proxyResponse.headers.location = rewriteSessionLocation(location, target);
      },
      error(error, request, response) {
        logger.warn?.('MediaMTX signaling proxy failed', {
          method: request.method,
          path: request.originalUrl || request.url,
          error: error.message,
        });
        if (response.headersSent) {
          response.destroy(error);
          return;
        }
        response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Media signaling is temporarily unavailable.');
      },
    },
  });
}

module.exports = {
  INTERNAL_WEBRTC_ORIGIN,
  PUBLIC_MEDIA_PREFIX,
  createMediaMtxProxy,
  rewriteSessionLocation,
};
