// Startup Data Restore
// Purpose: Applies a previously validated restore before any application database opens and rolls back an interrupted start.
// Scope: Operates only on top-level entries inside SERVER_DATA_DIR while preserving backupRestoreService control state.
const fs = require('fs');
const path = require('path');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const { CONTROL_DIR_NAME } = require('./backup');

const controlDir = resolveDataPath(CONTROL_DIR_NAME);
const pendingPath = path.join(controlDir, 'pending.json');
const rollbackDir = path.join(controlDir, 'rollback');
const lastResultPath = path.join(controlDir, 'last-result.json');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function readPending() {
  try {
    return JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function listActiveDataEntries({ includeRuntime = true } = {}) {
  fs.mkdirSync(resolveDataDir(), { recursive: true });
  return fs.readdirSync(resolveDataDir()).filter((name) => (
    name !== CONTROL_DIR_NAME && (includeRuntime || name !== 'runtime')
  ));
}

function removeActiveData() {
  for (const name of listActiveDataEntries()) {
    fs.rmSync(path.join(resolveDataDir(), name), { recursive: true, force: true });
  }
}

function moveChildren(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const name of fs.readdirSync(sourceDir)) {
    fs.renameSync(path.join(sourceDir, name), path.join(destinationDir, name));
  }
}

function restoreRollback(pending, errorMessage) {
  removeActiveData();
  moveChildren(rollbackDir, resolveDataDir());
  writeJson(lastResultPath, {
    status: 'rolled-back',
    restoreId: pending.restoreId,
    completedAt: Date.now(),
    error: errorMessage,
  });
  fs.rmSync(pendingPath, { force: true });
}

function applyPendingRestore() {
  const pending = readPending();
  if (!pending) return null;

  /*
    Reaching startup again in either state means the replacement process did
    not reach the HTTP-listening success marker. The complete rollback copy was
    created before active data was touched, so restoring it is deterministic.
  */
  if (pending.state === 'applying' || pending.state === 'awaiting-health') {
    restoreRollback(pending, 'The restored application did not finish starting.');
    return { status: 'rolled-back', restoreId: pending.restoreId };
  }

  const jobDir = path.join(controlDir, `restore-${pending.restoreId}`);
  const replacementDir = path.join(jobDir, 'extracted', 'data');
  if (!fs.existsSync(path.join(jobDir, 'validated.json'))
    || !fs.existsSync(replacementDir)
    || !fs.statSync(replacementDir).isDirectory()) {
    fs.rmSync(pendingPath, { force: true });
    writeJson(lastResultPath, {
      status: 'failed',
      restoreId: pending.restoreId,
      completedAt: Date.now(),
      error: 'Validated restore staging is missing.',
    });
    return { status: 'failed', restoreId: pending.restoreId };
  }

  try {
    fs.rmSync(rollbackDir, { recursive: true, force: true });
    fs.mkdirSync(rollbackDir, { recursive: true });
    // Startup runs before any database or writer opens. Copying the entire
    // current payload first gives every later replacement step one complete,
    // local rollback source even if the process is interrupted halfway through.
    for (const name of listActiveDataEntries({ includeRuntime: false })) {
      fs.cpSync(path.join(resolveDataDir(), name), path.join(rollbackDir, name), { recursive: true });
    }
    writeJson(pendingPath, { ...pending, state: 'applying', applyingAt: Date.now() });
    removeActiveData();
    moveChildren(replacementDir, resolveDataDir());
    writeJson(pendingPath, { ...pending, state: 'awaiting-health', appliedAt: Date.now() });
    return { status: 'awaiting-health', restoreId: pending.restoreId };
  } catch (error) {
    if (fs.existsSync(rollbackDir)) restoreRollback(pending, error.message);
    else fs.rmSync(pendingPath, { force: true });
    return { status: 'rolled-back', restoreId: pending.restoreId, error: error.message };
  }
}

function markStartupSuccessful() {
  const pending = readPending();
  if (!pending || pending.state !== 'awaiting-health') return null;
  const jobDir = path.join(controlDir, `restore-${pending.restoreId}`);
  fs.rmSync(rollbackDir, { recursive: true, force: true });
  fs.rmSync(jobDir, { recursive: true, force: true });
  fs.rmSync(pendingPath, { force: true });
  const result = {
    status: 'restored',
    restoreId: pending.restoreId,
    completedAt: Date.now(),
  };
  writeJson(lastResultPath, result);
  return result;
}

function getLastRestoreResult() {
  try {
    return JSON.parse(fs.readFileSync(lastResultPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

module.exports = {
  applyPendingRestore,
  getLastRestoreResult,
  markStartupSuccessful,
  pendingPath,
  writeJson,
};
