// Data Paths Helper Tests
// Purpose: Pins the one-root persistence contract used by local, systemd, and future container deployments.
// Scope: Exercises path resolution only and never creates files in the real server data directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const {
  resolveDataDir,
  resolveDataPath,
  resolveRoverSnapshotDir,
  resolveRuntimePath,
} = require('./dataPaths');

const originalDataDir = process.env.SERVER_DATA_DIR;

test.afterEach(() => {
  /*
    Environment state is process-global. Restore the caller's value after each
    assertion so this focused test remains safe when it is composed with other
    tests in the same Node process later.
  */
  if (originalDataDir === undefined) delete process.env.SERVER_DATA_DIR;
  else process.env.SERVER_DATA_DIR = originalDataDir;
});

test('defaults every persistent path to the canonical server data directory', () => {
  delete process.env.SERVER_DATA_DIR;
  const expectedRoot = path.resolve(__dirname, '..', '..', 'data');

  assert.equal(resolveDataDir(), expectedRoot);
  assert.equal(resolveDataPath('identity.sqlite'), path.join(expectedRoot, 'identity.sqlite'));
  assert.equal(resolveRoverSnapshotDir(), path.join(expectedRoot, 'rover-snapshots'));
  assert.equal(resolveRuntimePath('replay-builds'), path.join(expectedRoot, 'runtime', 'replay-builds'));
});

test('moves every persistent path beneath SERVER_DATA_DIR when it is configured', () => {
  const configuredRoot = path.join(os.tmpdir(), 'multirover-data-path-test');
  process.env.SERVER_DATA_DIR = configuredRoot;

  assert.equal(resolveDataDir(), path.resolve(configuredRoot));
  assert.equal(resolveDataPath('fleet-reports.sqlite'), path.join(configuredRoot, 'fleet-reports.sqlite'));
  assert.equal(resolveDataPath(path.join('replays', 'example.mp4')), path.join(configuredRoot, 'replays', 'example.mp4'));
  assert.equal(resolveRoverSnapshotDir(), path.join(configuredRoot, 'rover-snapshots'));
  assert.equal(
    resolveRuntimePath('audio-forward', 'uploads'),
    path.join(configuredRoot, 'runtime', 'audio-forward', 'uploads'),
  );
});
