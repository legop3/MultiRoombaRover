// Audio Forward Policy Tests
// Purpose: Verifies that mute blocks user-owned forwarding without changing ordinary driver authorization.
// Scope: Exercises the pure permission policy with small injected role, rover, and turn doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioForwardPolicy } = require('./policy');

function createPolicy({ verified = true, muted = false, driver = true, canDrive = true } = {}) {
  return createAudioForwardPolicy({
    isVerified: () => verified,
    isMuted: () => muted,
    roverManager: { isDriver: () => driver },
    turnService: { canDrive: () => canDrive },
    streamSuffix: '-fwd',
    mediaConfig: {},
  });
}

test('rejects audio forwarding for a muted verified driver', () => {
  const policy = createPolicy({ muted: true });
  assert.throws(() => policy.ensureAudioForwardPermission({}, 'rover'), /Muted/);
});

test('preserves normal audio forwarding for an unmuted verified driver', () => {
  const policy = createPolicy();
  assert.doesNotThrow(() => policy.ensureAudioForwardPermission({}, 'rover'));
});

test('publishes forwarded audio to the local MediaMTX RTSP path', () => {
  const policy = createPolicy();
  assert.equal(policy.resolveForwardUrl('rover one'), 'rtsp://127.0.0.1:8554/rover%20one-fwd');
});
