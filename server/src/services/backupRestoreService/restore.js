// Full Data Restore Validation
// Purpose: Safely extracts and validates an uploaded MultiRover backup before it can become a pending restore.
// Scope: Never changes active data; startupRestore owns the later replacement and rollback transaction.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const Database = require('better-sqlite3');
const tar = require('tar');
const {
  DATABASE_NAMES,
  FORMAT_VERSION,
  readDatabaseSchemaVersions,
  removeSnapshotSidecars,
  sha256File,
} = require('./backup');

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100000;
const RESERVED_DATA_NAMES = new Set(['backup-restore', 'runtime']);
const SUPPORTED_DATABASE_SCHEMA_VERSIONS = {
  configuration: 2,
  identity: 4,
  fleetReports: 0,
};

function normalizeArchivePath(value) {
  const raw = String(value || '');
  if (!raw || raw.includes('\\') || path.posix.isAbsolute(raw)) return null;
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  const normalized = path.posix.normalize(withoutTrailingSlash);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function assertAllowedArchiveEntry(entry) {
  const normalized = normalizeArchivePath(entry.path);
  if (!normalized || (normalized !== 'manifest.json' && normalized !== 'data' && !normalized.startsWith('data/'))) {
    throw new Error(`Backup contains an invalid archive path: ${entry.path}`);
  }
  if (!['File', 'Directory'].includes(entry.type)) {
    throw new Error(`Backup contains unsupported entry type ${entry.type}: ${entry.path}`);
  }
  if (normalized.startsWith('data/')) {
    const topLevelName = normalized.slice('data/'.length).split('/')[0];
    if (RESERVED_DATA_NAMES.has(topLevelName)) {
      throw new Error(`Backup contains reserved data path: ${entry.path}`);
    }
  }
  return normalized;
}

async function inspectArchive(archivePath) {
  let entryCount = 0;
  let extractedBytes = 0;
  const paths = new Set();
  let validationError = null;
  await tar.t({
    file: archivePath,
    strict: true,
    onentry: (entry) => {
      if (validationError) return;
      try {
        entryCount += 1;
        extractedBytes += Number(entry.size) || 0;
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('Backup contains too many files.');
        if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('Backup expands beyond the restore size limit.');
        const normalized = assertAllowedArchiveEntry(entry);
        if (paths.has(normalized)) throw new Error(`Backup contains duplicate path: ${normalized}`);
        paths.add(normalized);
      } catch (error) {
        /*
          tar invokes onentry from its parser event stack, where throwing would
          become an uncaught exception instead of rejecting tar.t(). Retain the
          first failure and raise it immediately after the bounded listing.
        */
        validationError = error;
      }
    },
  });
  if (validationError) throw validationError;
  if (!paths.has('manifest.json') || !paths.has('data')) {
    throw new Error('Backup must contain manifest.json and one data directory.');
  }
}

async function listExtractedFiles(rootDir, relativeDir = '') {
  const entries = await fsp.readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    const fullPath = path.join(rootDir, relativePath);
    const stat = await fsp.lstat(fullPath);
    if (stat.isSymbolicLink()) throw new Error(`Restored data contains symbolic link: ${relativePath}`);
    if (stat.isDirectory()) {
      files.push(...await listExtractedFiles(rootDir, relativePath));
      continue;
    }
    if (!stat.isFile()) throw new Error(`Restored data contains special file: ${relativePath}`);
    files.push({
      path: relativePath.split(path.sep).join('/'),
      size: stat.size,
      sha256: await sha256File(fullPath),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function verifySqliteDatabase(filePath, name) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error(`${name} failed SQLite integrity validation.`);
  } finally {
    database.close();
  }
}

async function validateExtractedRestore(extractDir) {
  const manifestPath = path.join(extractDir, 'manifest.json');
  const payloadDir = path.join(extractDir, 'data');
  const manifestStat = await fsp.stat(manifestPath);
  if (manifestStat.size > 10 * 1024 * 1024) throw new Error('Backup manifest is unreasonably large.');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (manifest.format !== 'multirover-full-backup' || manifest.formatVersion !== FORMAT_VERSION) {
    throw new Error('Backup format or version is not supported.');
  }
  if (!Array.isArray(manifest.files)) throw new Error('Backup manifest has no file inventory.');

  const expected = [...manifest.files].sort((left, right) => String(left.path).localeCompare(String(right.path)));
  const actual = await listExtractedFiles(payloadDir);
  if (expected.length !== actual.length) {
    /*
      Keep the strict complete-inventory check, but identify a few differences
      so an operator can distinguish a missing file from an unexpected archive
      entry without weakening restore validation or exposing file contents.
    */
    const expectedPaths = new Set(expected.map((entry) => entry.path));
    const actualPaths = new Set(actual.map((entry) => entry.path));
    const missing = expected.filter((entry) => !actualPaths.has(entry.path)).map((entry) => entry.path).slice(0, 5);
    const unexpected = actual.filter((entry) => !expectedPaths.has(entry.path)).map((entry) => entry.path).slice(0, 5);
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      unexpected.length ? `unexpected: ${unexpected.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Backup file inventory does not match the archive${details ? ` (${details})` : ''}.`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const found = actual[index];
    if (wanted.path !== found.path || wanted.size !== found.size || wanted.sha256 !== found.sha256) {
      throw new Error(`Backup checksum or size mismatch: ${wanted.path || found.path}`);
    }
  }

  for (const databaseName of DATABASE_NAMES) {
    if (!actual.some((entry) => entry.path === databaseName)) {
      throw new Error(`Backup is missing required database: ${databaseName}`);
    }
    verifySqliteDatabase(path.join(payloadDir, databaseName), databaseName);
  }
  const actualSchemaVersions = readDatabaseSchemaVersions(payloadDir);
  for (const [databaseName, version] of Object.entries(actualSchemaVersions)) {
    // JSON object property order has no meaning. Compare each known database by
    // name so an otherwise valid manifest is not rejected merely because a
    // different JSON writer emitted its keys in another order.
    if (Number(manifest.databaseSchemaVersions?.[databaseName]) !== version) {
      throw new Error('Backup database schema versions do not match its manifest.');
    }
    if (version > SUPPORTED_DATABASE_SCHEMA_VERSIONS[databaseName]) {
      throw new Error(`Backup ${databaseName} database is newer than this application supports.`);
    }
  }
  /*
    Integrity and schema reads can create fresh WAL coordination files even
    though the uploaded snapshot initially matched its manifest exactly. Remove
    those validation-only files so startup applies only inventoried content.
  */
  await removeSnapshotSidecars(payloadDir);
  return manifest;
}

async function prepareRestoreArchive({ archivePath, jobDir, actor }) {
  const archiveStat = await fsp.stat(archivePath);
  if (!archiveStat.isFile() || archiveStat.size <= 0 || archiveStat.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Backup archive is empty or exceeds the restore size limit.');
  }
  await inspectArchive(archivePath);
  const extractDir = path.join(jobDir, 'extracted');
  await fsp.rm(extractDir, { recursive: true, force: true });
  await fsp.mkdir(extractDir, { recursive: true });
  // Data files never need executable or set-id permissions from an uploaded
  // archive. Let the server account's umask choose safe extraction modes.
  await tar.x({ cwd: extractDir, file: archivePath, strict: true, preservePaths: false, noChmod: true });
  const manifest = await validateExtractedRestore(extractDir);
  const summary = {
    createdAt: manifest.createdAt,
    applicationVersion: manifest.applicationVersion,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((total, entry) => total + Number(entry.size || 0), 0),
    skippedUnstableFiles: Array.isArray(manifest.skippedUnstableFiles) ? manifest.skippedUnstableFiles : [],
  };
  await fsp.writeFile(
    path.join(jobDir, 'validated.json'),
    `${JSON.stringify({ actor, validatedAt: Date.now(), summary }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  return summary;
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  inspectArchive,
  prepareRestoreArchive,
  validateExtractedRestore,
};
