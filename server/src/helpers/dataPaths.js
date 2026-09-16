// data Paths helper
// Purpose: Defines the single filesystem boundary for all mutable, persistent server data.
// Scope: Resolves the configured data root and every application-owned mutable path beneath it.
const path = require('path');

const CANONICAL_DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const ROVER_SNAPSHOT_DIR_NAME = 'rover-snapshots';
const RUNTIME_DIR_NAME = 'runtime';

function resolveDataDir() {
  const configured = String(process.env.SERVER_DATA_DIR || '').trim();
  if (configured) return path.resolve(configured);
  return CANONICAL_DATA_DIR;
}

function resolveDataPath(fileName) {
  /*
    Always join through resolveDataDir instead of repeating environment handling
    in individual services. This is what makes one SERVER_DATA_DIR mount contain
    every database, JSON store, generated file, and persistent media directory.
  */
  return path.join(resolveDataDir(), fileName);
}

function resolveRoverSnapshotDir() {
  /*
    Snapshot production, polling, PTZ reads, and health reporting must use the
    exact same directory. Giving this shared directory a named resolver prevents
    one of those consumers from drifting back to the former /var/lib location.
  */
  return resolveDataPath(ROVER_SNAPSHOT_DIR_NAME);
}

function resolveRuntimePath(...pathSegments) {
  /*
    Disposable files are still files intentionally managed by the Node server.
    Keeping them below a named runtime directory preserves the single-root
    filesystem contract without confusing scratch files with durable stores.
    Callers remain responsible for deleting their own completed work.
  */
  return resolveDataPath(path.join(RUNTIME_DIR_NAME, ...pathSegments));
}

module.exports = {
  resolveDataDir,
  resolveDataPath,
  resolveRoverSnapshotDir,
  resolveRuntimePath,
};
