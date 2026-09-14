// MediaMTX HTTP Proxy Tests
// Purpose: Verifies streaming WHEP/WHIP method, body, header, path, and session-location behavior.
// Scope: Uses ephemeral loopback HTTP servers and always closes them; it never starts MediaMTX or the application server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { PUBLIC_MEDIA_PREFIX, createMediaMtxProxy, rewriteSessionLocation } = require('./proxy');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('streams WHEP session requests and keeps follow-up locations beneath /video', async () => {
  const received = [];
  const mediaMtx = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(201, {
        'Content-Type': 'application/sdp',
        Location: '/rover-one/whep/session-id',
      });
      response.end('answer');
    });
  });
  const mediaPort = await listen(mediaMtx);

  const app = express();
  const silentLogger = { info() {}, warn() {}, error() {} };
  app.use(PUBLIC_MEDIA_PREFIX, createMediaMtxProxy({
    target: `http://127.0.0.1:${mediaPort}`,
    logger: silentLogger,
  }));
  // If the proxy accidentally falls through, this parser would consume the
  // request and make the integration failure explicit instead of timing out.
  app.use(express.json());
  const nodeServer = http.createServer(app);
  const nodePort = await listen(nodeServer);

  try {
    const requests = [
      { method: 'POST', path: '/video/rover-one/whep', type: 'application/sdp', body: 'v=0\r\no=offer' },
      { method: 'PATCH', path: '/video/rover-one/whep/session-id', type: 'application/trickle-ice-sdpfrag', body: 'a=candidate' },
      { method: 'DELETE', path: '/video/rover-one/whep/session-id', type: 'application/trickle-ice-sdpfrag', body: '' },
    ];
    for (const request of requests) {
      const response = await fetch(`http://127.0.0.1:${nodePort}${request.path}`, {
        method: request.method,
        headers: { Authorization: 'Bearer session-token', 'Content-Type': request.type },
        body: request.method === 'DELETE' ? undefined : request.body,
      });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('location'), '/video/rover-one/whep/session-id');
      assert.equal(await response.text(), 'answer');
    }

    assert.deepEqual(received, requests.map((request) => ({
      method: request.method,
      path: request.path.slice('/video'.length),
      authorization: 'Bearer session-token',
      contentType: request.type,
      body: request.body,
    })));
  } finally {
    await close(nodeServer);
    await close(mediaMtx);
  }
});

test('rewrites only root-relative or internal absolute MediaMTX locations', () => {
  assert.equal(rewriteSessionLocation('/camera/whep/id'), '/video/camera/whep/id');
  assert.equal(rewriteSessionLocation('http://127.0.0.1:8889/camera/whep/id?one=two'), '/video/camera/whep/id?one=two');
  assert.equal(rewriteSessionLocation('whep/id'), 'whep/id');
  assert.equal(rewriteSessionLocation('https://example.com/camera/whep/id'), 'https://example.com/camera/whep/id');
});
