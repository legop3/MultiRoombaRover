// Video Auth HTTP Route Tests
// Purpose: Verifies credential-free LAN RTSP publishing without weakening browser read authorization.
// Scope: Invokes the registered route with lightweight request/response doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerVideoAuthRoute } = require('./httpRoute');

function createHarness() {
  let handler;
  const app = { post: (_path, fn) => { handler = fn; } };
  registerVideoAuthRoute({
    app,
    io: { sockets: { sockets: new Map() } },
    logger: { info() {}, warn() {} },
    videoSessions: { getSession: () => null, revokeSession() {} },
    getRequestIp: () => '127.0.0.1',
    logAdminEvent() {},
    extractStreamInfoFromBody: (body) => ({ type: 'rover', id: body.path, baseId: body.path }),
    canAccessStream: () => false,
  });

  function request(body) {
    const result = { statusCode: null };
    const response = {
      status(code) {
        result.statusCode = code;
        return response;
      },
      end() {
        return response;
      },
    };
    handler({ body }, response);
    return result.statusCode;
  }

  return { request };
}

test('allows an RTSP rover publisher without a browser session', () => {
  const { request } = createHarness();
  assert.equal(request({ protocol: 'rtsp', action: 'publish', path: 'rover-one' }), 200);
});

test('continues rejecting an unauthenticated WebRTC read', () => {
  const { request } = createHarness();
  assert.equal(request({ protocol: 'webrtc', action: 'read', path: 'rover-one' }), 401);
});
