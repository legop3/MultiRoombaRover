// data Paths helper
// Purpose: Resolves persistent data paths across refactors so services keep loading prior state files.
// Scope: Preserves runtime behavior by preferring configured/canonical paths while supporting legacy locations.
const fs = require('fs');
const path = require('path');

const CANONICAL_DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const LEGACY_DATA_DIR = path.resolve(__dirname, '..', 'data');

function pathExists(target) {
  try {
    fs.accessSync(target, fs.constants.F_OK);
    return true;
  } catch (_err) {
    return false;
  }
}

function resolveDataDir() {
  const configured = String(process.env.SERVER_DATA_DIR || '').trim();
  if (configured) return path.resolve(configured);
  if (pathExists(CANONICAL_DATA_DIR)) return CANONICAL_DATA_DIR;
  if (pathExists(LEGACY_DATA_DIR)) return LEGACY_DATA_DIR;
  return CANONICAL_DATA_DIR;
}

function resolveDataPath(fileName) {
  const configured = String(process.env.SERVER_DATA_DIR || '').trim();
  if (configured) return path.join(path.resolve(configured), fileName);

  const canonicalPath = path.join(CANONICAL_DATA_DIR, fileName);
  const legacyPath = path.join(LEGACY_DATA_DIR, fileName);
  if (pathExists(canonicalPath)) return canonicalPath;
  if (pathExists(legacyPath)) return legacyPath;
  return canonicalPath;
}

module.exports = {
  resolveDataDir,
  resolveDataPath,
};
