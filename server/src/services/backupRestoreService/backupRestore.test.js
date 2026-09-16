// Backup and Restore Service Tests
// Purpose: Verifies complete archive round trips, exclusions, malicious entry rejection, startup replacement, and rollback.
// Scope: Uses one isolated SERVER_DATA_DIR and injected SQLite owners; it never reads or changes development server data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const tar = require('tar');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multirover-backup-restore-'));
process.env.SERVER_DATA_DIR = temporaryRoot;

const { createFullBackup } = require('./backup');
const { inspectArchive, prepareRestoreArchive, validateExtractedRestore } = require('./restore');
const startupRestore = require('./startupRestore');
const VALID_RESTORE_ID = 'a'.repeat(64);

function createSourceDatabase(name) {
  /*
    Real service databases use WAL mode. Keeping fixture sources under the
    excluded runtime directory both mirrors that behavior and ensures their
    own live WAL files are not mistaken for ordinary durable backup content.
  */
  const sourceDirectory = path.join(temporaryRoot, 'runtime', 'database-sources');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  const filePath = path.join(sourceDirectory, name);
  const database = new Database(filePath);
  database.pragma('journal_mode = WAL');
  database.exec('CREATE TABLE example (value TEXT NOT NULL); INSERT INTO example VALUES (\'preserved\');');
  if (name === 'configuration.sqlite') {
    database.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (1);');
  } else if (name === 'identity.sqlite') {
    database.pragma('user_version = 4');
  }
  return database;
}

test.after(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('creates and validates a complete backup while excluding runtime and control data', async () => {
  await fsp.writeFile(path.join(temporaryRoot, 'state.json'), '{"preserved":true}\n');
  await fsp.mkdir(path.join(temporaryRoot, 'replays'), { recursive: true });
  await fsp.writeFile(path.join(temporaryRoot, 'replays', 'complete.mp4'), 'complete replay');
  await fsp.mkdir(path.join(temporaryRoot, 'runtime'), { recursive: true });
  await fsp.writeFile(path.join(temporaryRoot, 'runtime', 'active.tmp'), 'discard me');

  const sources = ['configuration.sqlite', 'identity.sqlite', 'fleet-reports.sqlite']
    .map(createSourceDatabase);
  const owners = sources.map((database) => ({
    backupDatabase: (destinationPath) => database.backup(destinationPath),
  }));
  const result = await createFullBackup({
    configurationDatabase: owners[0],
    identityService: owners[1],
    fleetReportService: owners[2],
    jobId: 'test-backup',
  });

  assert.ok(fs.statSync(result.archivePath).size > 0);
  assert.ok(result.manifest.files.some((entry) => entry.path === 'state.json'));
  assert.ok(result.manifest.files.some((entry) => entry.path === 'replays/complete.mp4'));
  assert.equal(result.manifest.files.some((entry) => entry.path.includes('runtime')), false);
  assert.equal(result.manifest.files.some((entry) => entry.path.includes('backup-restore')), false);
  assert.equal(result.manifest.files.some((entry) => entry.path.endsWith('-wal') || entry.path.endsWith('-shm')), false);

  const restoreJob = path.join(temporaryRoot, 'backup-restore', `restore-${VALID_RESTORE_ID}`);
  await fsp.mkdir(restoreJob, { recursive: true });
  const uploadedArchive = path.join(restoreJob, 'upload.tar.gz');
  await fsp.copyFile(result.archivePath, uploadedArchive);
  const summary = await prepareRestoreArchive({ archivePath: uploadedArchive, jobDir: restoreJob, actor: 'test' });
  assert.equal(summary.fileCount, result.manifest.files.length);
  const restoredNames = await fsp.readdir(path.join(restoreJob, 'extracted', 'data'));
  assert.equal(restoredNames.some((name) => name.endsWith('-wal') || name.endsWith('-shm')), false);

  sources.forEach((database) => database.close());
});

test('rejects a staged restore whose contents no longer match the manifest', async () => {
  const restoreJob = path.join(temporaryRoot, 'backup-restore', `restore-${VALID_RESTORE_ID}`);
  const statePath = path.join(restoreJob, 'extracted', 'data', 'state.json');
  await fsp.writeFile(statePath, '{"tampered":true}\n');
  await assert.rejects(validateExtractedRestore(path.join(restoreJob, 'extracted')), /checksum or size mismatch/);
  // Restore the known source content so the following startup-application test
  // continues to exercise a genuinely validated replacement payload.
  await fsp.writeFile(statePath, '{"preserved":true}\n');
});

test('rejects symbolic links before extracting an archive', async () => {
  const unsafeRoot = path.join(temporaryRoot, 'unsafe-archive');
  await fsp.mkdir(path.join(unsafeRoot, 'data'), { recursive: true });
  await fsp.writeFile(path.join(unsafeRoot, 'manifest.json'), '{}');
  await fsp.symlink('/etc/passwd', path.join(unsafeRoot, 'data', 'escape'));
  const archivePath = path.join(temporaryRoot, 'unsafe.tar.gz');
  await tar.c({ cwd: unsafeRoot, file: archivePath, gzip: true }, ['manifest.json', 'data']);
  await assert.rejects(inspectArchive(archivePath), /unsupported entry type/);
});

test('applies validated replacement data and removes rollback only after startup succeeds', () => {
  const restoreId = VALID_RESTORE_ID;
  const jobDir = path.join(temporaryRoot, 'backup-restore', `restore-${restoreId}`);
  fs.writeFileSync(path.join(temporaryRoot, 'old-state.txt'), 'old');
  fs.mkdirSync(path.join(temporaryRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(temporaryRoot, 'runtime', 'active.tmp'), 'discard during restore');
  startupRestore.writeJson(startupRestore.pendingPath, {
    restoreId,
    state: 'pending',
    requestedAt: Date.now(),
    actor: 'test',
  });

  const applied = startupRestore.applyPendingRestore();
  assert.equal(applied.status, 'awaiting-health');
  assert.equal(fs.existsSync(path.join(temporaryRoot, 'old-state.txt')), false);
  // Runtime is outside the durable backup payload and can contain state owned
  // by the separate lifecycle controller, so applying a restore preserves it.
  assert.equal(fs.readFileSync(path.join(temporaryRoot, 'runtime', 'active.tmp'), 'utf8'), 'discard during restore');
  assert.equal(fs.readFileSync(path.join(temporaryRoot, 'state.json'), 'utf8'), '{"preserved":true}\n');
  assert.equal(fs.existsSync(path.join(temporaryRoot, 'backup-restore', 'rollback', 'old-state.txt')), true);

  const completed = startupRestore.markStartupSuccessful();
  assert.equal(completed.status, 'restored');
  assert.equal(fs.existsSync(jobDir), false);
  assert.equal(fs.existsSync(startupRestore.pendingPath), false);
});

test('restores the rollback copy when a replaced application did not reach health', () => {
  const restoreId = 'b'.repeat(64);
  const rollbackDir = path.join(temporaryRoot, 'backup-restore', 'rollback');
  fs.mkdirSync(rollbackDir, { recursive: true });
  fs.writeFileSync(path.join(rollbackDir, 'state.json'), 'previous state');
  fs.writeFileSync(path.join(temporaryRoot, 'state.json'), 'failed replacement');
  startupRestore.writeJson(startupRestore.pendingPath, {
    restoreId,
    state: 'awaiting-health',
    requestedAt: Date.now(),
    actor: 'test',
  });

  const result = startupRestore.applyPendingRestore();
  assert.equal(result.status, 'rolled-back');
  assert.equal(fs.readFileSync(path.join(temporaryRoot, 'state.json'), 'utf8'), 'previous state');
  assert.equal(startupRestore.getLastRestoreResult().status, 'rolled-back');
});
