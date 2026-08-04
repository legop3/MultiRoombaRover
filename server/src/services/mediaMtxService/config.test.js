// MediaMTX Config Builder Tests
// Purpose: Pins the generated protocol policy and instance-specific ICE host handling.
// Scope: Tests pure configuration output without starting listeners or leaving a child process running.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMediaMtxConfig, normalizeAdditionalHosts } = require('./config');

test('generates RTSP over TCP without deployment-specific hardcodes', () => {
  const generated = buildMediaMtxConfig({
    config: {
      media: {
        whepBaseUrl: 'http://media.internal:8889/video',
        additionalHosts: ['public.example.com', '10.20.30.40'],
      },
    },
    serverPort: 8123,
    snapshotWriterPath: '/opt/multirover/rover-snapshot-writer.sh',
  });

  assert.equal(generated.rtsp, true);
  assert.equal(generated.rtspAddress, ':8554');
  assert.deepEqual(generated.rtspTransports, ['tcp']);
  assert.equal(Object.hasOwn(generated, 'rtpAddress'), false);
  assert.equal(Object.hasOwn(generated, 'rtcpAddress'), false);
  assert.deepEqual(generated.webrtcAdditionalHosts, ['public.example.com', '10.20.30.40']);
  assert.equal(generated.authHTTPAddress, 'http://127.0.0.1:8123/mediamtx/auth');
});

test('uses the configured WHEP hostname while an older config has no additionalHosts', () => {
  const generated = buildMediaMtxConfig({
    config: { media: { whepBaseUrl: 'https://second-server.example/video' } },
    serverPort: 8080,
    snapshotWriterPath: '/usr/local/bin/rover-snapshot-writer.sh',
  });

  assert.deepEqual(generated.webrtcAdditionalHosts, ['second-server.example']);
});

test('normalizes duplicate and empty additional hosts', () => {
  assert.deepEqual(
    normalizeAdditionalHosts([' media.local ', '', 'media.local', null, 'public.example']),
    ['media.local', 'public.example'],
  );
  assert.throws(() => normalizeAdditionalHosts('media.local'), /must be a list/);
});
