// Full Data Backup
// Purpose: Creates one validated archive of the durable server data without stopping live services or writers.
// Scope: Uses service-owned online database snapshots and stable file copies inside the canonical data directory.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const tar = require('tar');
const Database = require('better-sqlite3');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const packageInfo = require('../../../package.json');

const FORMAT_VERSION = 1;
const CONTROL_DIR_NAME = 'backup-restore';
const EXCLUDED_TOP_LEVEL_NAMES = new Set([CONTROL_DIR_NAME, 'runtime']);
const DATABASE_NAMES = ['configuration.sqlite', 'identity.sqlite', 'fleet-reports.sqlite'];
const DATABASE_FILES = new Set(DATABASE_NAMES.flatMap((name) => [name, `${name}-wal`, `${name}-shm`]));
const FILE_COPY_ATTEMPTS = 3;

async function removeSnapshotSidecars(payloadDir) {
  /*
    SQLite online backup produces a complete standalone main database file.
    Reopening that snapshot to inspect its schema can still create empty WAL
    and shared-memory coordination files because the database retains WAL as
    its journal mode. Those files describe no durable backup content and must
    be removed before the manifest inventory and tar archive are produced.
  */
  await Promise.all(DATABASE_NAMES.flatMap((name) => [
    fsp.rm(path.join(payloadDir, `${name}-wal`), { force: true }),
    fsp.rm(path.join(payloadDir, `${name}-shm`), { force: true }),
  ]));
}

function readDatabaseSchemaVersions(payloadDir) {
  const configuration = new Database(path.join(payloadDir, 'configuration.sqlite'), { readonly: true });
  const identity = new Database(path.join(payloadDir, 'identity.sqlite'), { readonly: true });
  const fleetReports = new Database(path.join(payloadDir, 'fleet-reports.sqlite'), { readonly: true });
  try {
    return {
      configuration: Number(configuration.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version) || 0,
      identity: Number(identity.pragma('user_version', { simple: true })) || 0,
      // Fleet reporting currently evolves with additive startup checks and has
      // no numbered migration table, so zero accurately identifies that scheme.
      fleetReports: Number(fleetReports.pragma('user_version', { simple: true })) || 0,
    };
  } finally {
    configuration.close();
    identity.close();
    fleetReports.close();
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function copyStableFile(sourcePath, destinationPath) {
  for (let attempt = 0; attempt < FILE_COPY_ATTEMPTS; attempt += 1) {
    try {
      const before = await fsp.stat(sourcePath);
      if (!before.isFile()) throw new Error(`Backup source is not a regular file: ${sourcePath}`);
      await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
      await fsp.copyFile(sourcePath, destinationPath);
      await fsp.chmod(destinationPath, before.mode & 0o777);

      /*
        A writer may replace or append to a media file while it is copied. Size
        and timestamp checks catch ordinary changes, while comparing hashes
        catches a same-size replacement. Only the unstable file is retried;
        no owning service is paused.
      */
      const [sourceHash, destinationHash] = await Promise.all([
        sha256File(sourcePath),
        sha256File(destinationPath),
      ]);
      // Read the final metadata only after both hashes finish. Starting this
      // stat concurrently could miss a write that occurred during hashing.
      const after = await fsp.stat(sourcePath);
      if (before.size === after.size
        && before.mtimeMs === after.mtimeMs
        && sourceHash === destinationHash) return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A rotating snapshot can disappear between directory enumeration and
      // copying. Treat that exact race like any other unstable active file.
    }
    await fsp.rm(destinationPath, { force: true });
  }
  return false;
}

async function copyDurableTree(sourceDir, destinationDir, relativeDir = '') {
  let entries;
  try {
    entries = await fsp.readdir(path.join(sourceDir, relativeDir), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const skipped = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (!relativeDir && EXCLUDED_TOP_LEVEL_NAMES.has(entry.name)) continue;
    if (!relativeDir && DATABASE_FILES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Backup cannot include symbolic link: ${relativePath}`);
    if (entry.isDirectory()) {
      skipped.push(...await copyDurableTree(sourceDir, destinationDir, relativePath));
      continue;
    }
    if (!entry.isFile()) throw new Error(`Backup cannot include special file: ${relativePath}`);
    const copied = await copyStableFile(
      path.join(sourceDir, relativePath),
      path.join(destinationDir, relativePath),
    );
    if (!copied) skipped.push(relativePath.split(path.sep).join('/'));
  }
  return skipped;
}

async function listManifestFiles(rootDir, relativeDir = '') {
  const entries = await fsp.readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listManifestFiles(rootDir, relativePath));
      continue;
    }
    if (!entry.isFile()) throw new Error(`Backup staging contains a special file: ${relativePath}`);
    const filePath = path.join(rootDir, relativePath);
    const stat = await fsp.stat(filePath);
    files.push({
      path: relativePath.split(path.sep).join('/'),
      size: stat.size,
      sha256: await sha256File(filePath),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function createFullBackup({ configurationDatabase, identityService, fleetReportService, jobId }) {
  const dataDir = resolveDataDir();
  const jobDir = resolveDataPath(path.join(CONTROL_DIR_NAME, `backup-${jobId}`));
  const payloadDir = path.join(jobDir, 'data');
  const archivePath = path.join(jobDir, 'multirover-backup.tar.gz');
  await fsp.rm(jobDir, { recursive: true, force: true });
  await fsp.mkdir(payloadDir, { recursive: true });

  try {
    // Each database owner remains live and writes a coherent SQLite snapshot
    // directly into the same staging tree as the ordinary durable files.
    await Promise.all([
      configurationDatabase.backupDatabase(path.join(payloadDir, DATABASE_NAMES[0])),
      identityService.backupDatabase(path.join(payloadDir, DATABASE_NAMES[1])),
      fleetReportService.backupDatabase(path.join(payloadDir, DATABASE_NAMES[2])),
    ]);
    const skippedUnstableFiles = await copyDurableTree(dataDir, payloadDir);
    /*
      Finish every operation that can create a staged file before inventorying
      the payload. Production databases use WAL mode, so schema inspection must
      precede both sidecar cleanup and the final immutable file list.
    */
    const databaseSchemaVersions = readDatabaseSchemaVersions(payloadDir);
    await removeSnapshotSidecars(payloadDir);
    const files = await listManifestFiles(payloadDir);
    const manifest = {
      format: 'multirover-full-backup',
      formatVersion: FORMAT_VERSION,
      applicationVersion: packageInfo.version,
      createdAt: Date.now(),
      databaseSchemaVersions,
      files,
      skippedUnstableFiles,
    };
    await fsp.writeFile(path.join(jobDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await tar.c({ cwd: jobDir, file: archivePath, gzip: true, portable: true }, ['manifest.json', 'data']);
    return { archivePath, jobDir, manifest };
  } catch (error) {
    await fsp.rm(jobDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  CONTROL_DIR_NAME,
  DATABASE_NAMES,
  FORMAT_VERSION,
  createFullBackup,
  readDatabaseSchemaVersions,
  removeSnapshotSidecars,
  sha256File,
};
