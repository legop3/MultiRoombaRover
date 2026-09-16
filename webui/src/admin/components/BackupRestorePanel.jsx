// Backup and Restore Administration
// Purpose: Downloads one complete server backup and validates a selected archive before explicit restore confirmation.
// Scope: Transfers large bytes over one-use HTTP URLs while protected socket actions own authorization and restart intent.
import { useEffect, useState } from 'react';
import CardFrame from '../../components/CardFrame/index.jsx';
import {
  confirmFullRestore,
  createFullBackup,
  createRestoreUpload,
  getBackupRestoreStatus,
} from '../api.js';

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export default function BackupRestorePanel({ socket, runSensitive }) {
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [backupFile, setBackupFile] = useState(null);
  const [validatedRestore, setValidatedRestore] = useState(null);
  const [lastRestore, setLastRestore] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getBackupRestoreStatus(socket)
      .then((response) => setLastRestore(response.lastRestore))
      .catch((error) => setMessage(error.message));
  }, [socket]);

  async function downloadBackup() {
    setBackupBusy(true);
    setMessage('Creating consistent database snapshots and copying server data…');
    try {
      const response = await runSensitive(() => createFullBackup(socket));
      /*
        A temporary anchor begins a normal streamed browser download without
        navigating away from administration. The one-use URL contains no
        credentials and expires if the browser never requests it.
      */
      const link = document.createElement('a');
      link.href = response.downloadUrl;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
      const skipped = response.skippedUnstableFiles?.length || 0;
      setMessage(`Backup download started with ${response.fileCount} files.${skipped ? ` ${skipped} actively changing file(s) were skipped.` : ''}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBackupBusy(false);
    }
  }

  async function validateRestore() {
    if (!backupFile) return;
    setRestoreBusy(true);
    setValidatedRestore(null);
    setMessage('Uploading and validating the selected backup…');
    try {
      const authorization = await runSensitive(() => createRestoreUpload(socket));
      const uploadResponse = await fetch(authorization.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/gzip' },
        body: backupFile,
      });
      const result = await uploadResponse.json();
      if (!uploadResponse.ok || result.error) throw new Error(result.error || 'Restore upload failed.');
      setValidatedRestore(result);
      setMessage('Backup validated. Review the summary before replacing server data.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRestoreBusy(false);
    }
  }

  async function restore() {
    if (!validatedRestore) return;
    const confirmed = window.confirm(
      'Replace the complete server data folder with this backup and restart the application? Configuration, administrators, identities, history, and media will all be replaced.',
    );
    if (!confirmed) return;
    setRestoreBusy(true);
    try {
      await runSensitive(() => confirmFullRestore(socket, validatedRestore.restoreId));
      setMessage('Restore accepted. Waiting for the application to restart…');
    } catch (error) {
      setRestoreBusy(false);
      setMessage(error.message);
    }
  }

  return (
    <div className="space-y-0.5">
      <CardFrame title="Full backup" bodyClassName="space-y-0.5 p-1 text-sm">
        <p className="text-slate-300">Downloads configuration, administrator accounts, secrets, identities, history, snapshots, replays, and other durable server data. Keep the archive private because it contains credentials.</p>
        <button type="button" className="button-dark" disabled={backupBusy || restoreBusy} onClick={downloadBackup}>
          {backupBusy ? 'Creating backup…' : 'Download full backup'}
        </button>
      </CardFrame>

      <CardFrame title="Full restore" bodyClassName="space-y-0.5 p-1 text-sm">
        <p className="text-slate-300">Upload a MultiRover full backup for validation. Nothing changes until the validated restore is confirmed.</p>
        <div className="flex max-w-3xl flex-col gap-0.5 md:flex-row">
          <input
            className="field-input min-w-0 flex-1"
            type="file"
            accept=".gz,.tgz,application/gzip"
            disabled={restoreBusy || backupBusy}
            onChange={(event) => {
              setBackupFile(event.target.files?.[0] || null);
              setValidatedRestore(null);
            }}
          />
          <button type="button" className="button-dark" disabled={!backupFile || restoreBusy || backupBusy} onClick={validateRestore}>
            {restoreBusy && !validatedRestore ? 'Validating…' : 'Validate backup'}
          </button>
        </div>
        {validatedRestore ? (
          <div className="surface max-w-3xl space-y-0.5 p-1">
            <p>{validatedRestore.summary.fileCount} files, {formatBytes(validatedRestore.summary.totalBytes)}</p>
            <p>Created {new Date(validatedRestore.summary.createdAt).toLocaleString()} by application version {validatedRestore.summary.applicationVersion}</p>
            <button type="button" className="button-danger" disabled={restoreBusy} onClick={restore}>Replace data and restart</button>
          </div>
        ) : null}
      </CardFrame>

      {message ? <CardFrame title="Backup and restore status" bodyClassName="p-1 text-sm text-slate-200"><p>{message}</p></CardFrame> : null}
      {lastRestore ? (
        <CardFrame title="Last restore" meta={lastRestore.status} bodyClassName="p-1 text-sm text-slate-300">
          <p>{lastRestore.completedAt ? new Date(lastRestore.completedAt).toLocaleString() : 'Completion time unavailable'}{lastRestore.error ? ` — ${lastRestore.error}` : ''}</p>
        </CardFrame>
      ) : null}
    </div>
  );
}
