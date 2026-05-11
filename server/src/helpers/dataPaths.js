// data Paths helper
// Purpose: Resolves persistent data paths for server state.
// Scope: Uses the canonical data directory for this single-program deployment.
const path = require('path');

const CANONICAL_DATA_DIR = path.resolve(__dirname, '..', '..', 'data');

function resolveDataDir() {
  return CANONICAL_DATA_DIR;
}

function resolveDataPath(fileName) {
  return path.join(CANONICAL_DATA_DIR, fileName);
}

module.exports = {
  resolveDataDir,
  resolveDataPath,
};
