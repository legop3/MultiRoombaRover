// Backup and Restore Service
// Purpose: Owns full-data archive creation, browser transfer, staged restore confirmation, startup replacement, and rollback.
// Scope: All backup/restore orchestration stays in this service; database owners expose only their online snapshot operations.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { resolveDataPath } = require('../../helpers/dataPaths');
const { CONTROL_DIR_NAME, createFullBackup } = require('./backup');
const { MAX_ARCHIVE_BYTES, prepareRestoreArchive } = require('./restore');
const startupRestore = require('./startupRestore');

const TOKEN_LIFETIME_MS = 10 * 60 * 1000;
const controlDir = resolveDataPath(CONTROL_DIR_NAME);
const downloads = new Map();
const uploads = new Map();
let backupInProgress = false;
let registered = false;
let app;
let io;
let logger;
let getConfigurationDatabase;
let identityService;
let fleetReportService;
let requireLockdownAdministrator;
let requireRecentPassword;
let requestApplicationRestart;
let isApplicationRestartPending;

function actorFor(socket) {
  return socket?.data?.user?.username || socket.id;
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function pruneExpiredTransfers() {
  const now = Date.now();
  for (const [token, transfer] of [...downloads, ...uploads]) {
    if (transfer.expiresAt > now) continue;
    downloads.delete(token);
    uploads.delete(token);
    if (transfer.jobDir) fsp.rm(transfer.jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function responseError(cb, error) {
  logger.warn('Backup or restore request failed', { error: error.message });
  cb({ error: error.message, code: error.code || null });
}

function removeOrphanedStaging() {
  let pendingRestoreId = null;
  try {
    pendingRestoreId = JSON.parse(fs.readFileSync(startupRestore.pendingPath, 'utf8')).restoreId || null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const entry of fs.readdirSync(controlDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const preservedName = pendingRestoreId ? `restore-${pendingRestoreId}` : null;
    if ((entry.name.startsWith('backup-') || entry.name.startsWith('restore-'))
      && entry.name !== preservedName) {
      /*
        Transfer authorization lives only in process memory. After a restart,
        an unconfirmed upload or undownloaded archive can no longer be reached,
        so deleting it prevents abandoned full-data copies from accumulating.
      */
      fs.rmSync(path.join(controlDir, entry.name), { recursive: true, force: true });
    }
  }
}

function registerSocketApi() {
  io.on('connection', (socket) => {
    socket.on('backupRestore:status', (_payload = {}, cb = () => {}) => {
      try {
        requireLockdownAdministrator(socket);
        cb({ success: true, lastRestore: startupRestore.getLastRestoreResult() });
      } catch (error) {
        responseError(cb, error);
      }
    });

    socket.on('backupRestore:createBackup', (_payload = {}, cb = () => {}) => {
      Promise.resolve().then(async () => {
        requireRecentPassword(socket);
        if (backupInProgress) throw new Error('A full backup is already being created.');
        backupInProgress = true;
        try {
          pruneExpiredTransfers();
          const jobId = createToken();
          const result = await createFullBackup({
            configurationDatabase: getConfigurationDatabase(),
            identityService,
            fleetReportService,
            jobId,
          });
          const token = createToken();
          downloads.set(token, {
            archivePath: result.archivePath,
            jobDir: result.jobDir,
            expiresAt: Date.now() + TOKEN_LIFETIME_MS,
          });
          getConfigurationDatabase().recordAuditEvent(actorFor(socket), 'backup.created', {
            fileCount: result.manifest.files.length,
            skippedUnstableFileCount: result.manifest.skippedUnstableFiles.length,
          });
          cb({
            success: true,
            downloadUrl: `/admin-api/backup/${token}`,
            fileCount: result.manifest.files.length,
            skippedUnstableFiles: result.manifest.skippedUnstableFiles,
          });
        } finally {
          backupInProgress = false;
        }
      }).catch((error) => responseError(cb, error));
    });

    socket.on('backupRestore:createRestoreUpload', (_payload = {}, cb = () => {}) => {
      try {
        requireRecentPassword(socket);
        pruneExpiredTransfers();
        const token = createToken();
        uploads.set(token, {
          actor: actorFor(socket),
          expiresAt: Date.now() + TOKEN_LIFETIME_MS,
        });
        cb({ success: true, uploadUrl: `/admin-api/restore/${token}` });
      } catch (error) {
        responseError(cb, error);
      }
    });

    socket.on('backupRestore:confirmRestore', ({ restoreId } = {}, cb = () => {}) => {
      try {
        requireRecentPassword(socket);
        const safeRestoreId = String(restoreId || '');
        if (!/^[a-f0-9]{64}$/.test(safeRestoreId)) throw new Error('Validated restore was not found.');
        if (isApplicationRestartPending()) throw new Error('Application restart already pending.');
        if (fs.existsSync(startupRestore.pendingPath)) throw new Error('A restore is already pending.');
        const jobDir = path.join(controlDir, `restore-${safeRestoreId}`);
        if (!fs.existsSync(path.join(jobDir, 'validated.json'))) throw new Error('Validated restore was not found.');
        startupRestore.writeJson(startupRestore.pendingPath, {
          restoreId: safeRestoreId,
          state: 'pending',
          requestedAt: Date.now(),
          actor: actorFor(socket),
        });
        getConfigurationDatabase().recordAuditEvent(actorFor(socket), 'restore.requested', { restoreId: safeRestoreId });
        requestApplicationRestart({ actor: actorFor(socket), reason: 'restore-requested' });
        cb({ success: true });
      } catch (error) {
        responseError(cb, error);
      }
    });
  });
}

function registerHttpApi() {
  app.get('/admin-api/backup/:token', (req, res) => {
    pruneExpiredTransfers();
    const transfer = downloads.get(String(req.params.token || ''));
    if (!transfer) {
      res.status(404).send('Backup download is missing or expired.');
      return;
    }
    downloads.delete(req.params.token);
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="multirover-backup-${new Date().toISOString().slice(0, 10)}.tar.gz"`,
      'Cache-Control': 'no-store',
    });
    const cleanup = () => fsp.rm(transfer.jobDir, { recursive: true, force: true }).catch(() => undefined);
    res.once('close', cleanup);
    fs.createReadStream(transfer.archivePath).on('error', (error) => {
      logger.warn('Backup download failed', { error: error.message });
      if (!res.headersSent) res.status(500).end();
      else res.destroy(error);
    }).pipe(res);
  });

  app.put('/admin-api/restore/:token', async (req, res) => {
    pruneExpiredTransfers();
    const token = String(req.params.token || '');
    const transfer = uploads.get(token);
    uploads.delete(token);
    if (!transfer) {
      res.status(404).json({ error: 'Restore upload is missing or expired.' });
      return;
    }
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
      res.status(413).json({ error: 'Backup archive exceeds the restore size limit.' });
      return;
    }

    const restoreId = createToken();
    const jobDir = path.join(controlDir, `restore-${restoreId}`);
    const archivePath = path.join(jobDir, 'upload.tar.gz');
    try {
      await fsp.mkdir(jobDir, { recursive: true });
      let receivedBytes = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          receivedBytes += chunk.length;
          callback(receivedBytes > MAX_ARCHIVE_BYTES
            ? new Error('Backup archive exceeds the restore size limit.')
            : null, chunk);
        },
      });
      await pipeline(req, limiter, fs.createWriteStream(archivePath, { mode: 0o600 }));
      const summary = await prepareRestoreArchive({ archivePath, jobDir, actor: transfer.actor });
      getConfigurationDatabase().recordAuditEvent(transfer.actor, 'restore.validated', {
        restoreId,
        fileCount: summary.fileCount,
        totalBytes: summary.totalBytes,
      });
      res.set('Cache-Control', 'no-store').json({ success: true, restoreId, summary });
    } catch (error) {
      await fsp.rm(jobDir, { recursive: true, force: true });
      logger.warn('Restore upload failed validation', { actor: transfer.actor, error: error.message });
      res.status(error.message.includes('size limit') ? 413 : 400).json({ error: error.message });
    }
  });
}

function register() {
  if (registered) return;
  registered = true;
  /*
    These runtime dependencies are deliberately loaded only after earliest
    startup restore has run. Several of them open SQLite immediately, so
    importing them at module scope would make replacement too late and unsafe.
  */
  ({ app } = require('../../globals/http'));
  io = require('../../globals/io');
  logger = require('../../globals/logger').child('backupRestoreService');
  ({ getConfigurationDatabase } = require('../../configuration'));
  identityService = require('../identityService');
  fleetReportService = require('../fleetReportService');
  ({ requireLockdownAdministrator, requireRecentPassword } = require('../adminConfigurationService'));
  ({ isApplicationRestartPending, requestApplicationRestart } = require('../serverControlService'));
  fs.mkdirSync(controlDir, { recursive: true });
  removeOrphanedStaging();
  registerHttpApi();
  registerSocketApi();
}

function markStartupSuccessful() {
  const result = startupRestore.markStartupSuccessful();
  if (result) {
    const configuration = require('../../configuration');
    configuration.getConfigurationDatabase().recordAuditEvent('system', 'restore.completed', { restoreId: result.restoreId });
  }
  return result;
}

module.exports = {
  applyPendingRestore: startupRestore.applyPendingRestore,
  markStartupSuccessful,
  register,
};
