// Administration Overview
// Purpose: Summarizes configuration state, revision history, audit history, and links to existing health/report surfaces.
// Scope: Presents persisted administration metadata without duplicating operational service implementations.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CardFrame from '../../components/CardFrame/index.jsx';
import {
  checkForApplicationUpdate,
  getApplicationLifecycleStatus,
  restartApplication,
  restoreConfigurationRevision,
  updateApplication,
} from '../api.js';

function formatDate(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleString() : 'unknown';
}

export default function AdminOverview({ snapshot, socket, runSensitive, onSnapshot }) {
  const config = snapshot.configuration;
  const [restartRequested, setRestartRequested] = useState(false);
  const [lifecycle, setLifecycle] = useState(null);
  const [lifecycleError, setLifecycleError] = useState('');

  useEffect(() => {
    let mounted = true;
    async function refreshLifecycle() {
      if (!socket.connected) return;
      try {
        const response = await getApplicationLifecycleStatus(socket);
        if (!mounted) return;
        setLifecycle(response.lifecycle);
        setLifecycleError('');
      } catch (error) {
        if (mounted) setLifecycleError(error.message);
      }
    }

    refreshLifecycle();
    // Update work continues while this application is being replaced. Polling
    // the controller gives the page current progress before disconnect and the
    // persisted final result immediately after Socket.IO reconnects.
    const timer = window.setInterval(refreshLifecycle, 2500);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [socket]);

  useEffect(() => {
    if (!restartRequested) return undefined;
    // The socket reconnect is the simplest authoritative success signal: the
    // replacement process is accepting browser connections again.
    const handleReconnect = () => setRestartRequested(false);
    socket.once('connect', handleReconnect);
    return () => socket.off('connect', handleReconnect);
  }, [restartRequested, socket]);

  async function restore(revision) {
    if (!window.confirm(`Restore configuration revision ${revision}? This creates and immediately applies a new active revision.`)) return;
    try {
      const response = await runSensitive(() => restoreConfigurationRevision(socket, {
        revision,
        expectedRevision: config.revision,
      }));
      onSnapshot(response.snapshot);
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function restart() {
    if (!window.confirm('Restart the MultiRover application now? Connected rovers and browsers will disconnect briefly; the server host will not reboot.')) return;
    setRestartRequested(true);
    try {
      await runSensitive(() => restartApplication(socket));
    } catch (error) {
      setRestartRequested(false);
      window.alert(error.message);
    }
  }

  async function checkForUpdate() {
    try {
      const response = await runSensitive(() => checkForApplicationUpdate(socket));
      setLifecycle(response.lifecycle);
    } catch (error) {
      setLifecycleError(error.message);
    }
  }

  async function update() {
    if (!window.confirm('Pull the configured MultiRover image and replace the application container now? The page will reconnect automatically.')) return;
    try {
      const response = await runSensitive(() => updateApplication(socket));
      setLifecycle(response.lifecycle);
    } catch (error) {
      setLifecycleError(error.message);
    }
  }

  const lifecycleBusy = lifecycle?.state === 'running';
  const lifecycleAvailable = Boolean(lifecycle?.available);
  const updateSummary = lifecycle?.updateAvailable === true
    ? 'An update is available.'
    : lifecycle?.updateAvailable === false
      ? 'The running application matches the latest checked image.'
      : 'Check for updates to compare the running container with the configured image.';

  return (
    <div className="space-y-0.5">
      <CardFrame title="Administration overview" meta={`revision ${config.revision}`} bodyClassName="grid gap-0.5 p-0.5 md:grid-cols-3">
        <div className="surface p-1"><p className="text-xs text-slate-400">Active revision</p><p className="text-xl font-semibold">{config.revision}</p></div>
        <div className="surface p-1"><p className="text-xs text-slate-400">Administrators</p><p className="text-xl font-semibold">{snapshot.administrators.length}</p></div>
        <div className="surface p-1"><p className="text-xs text-slate-400">Last configuration save</p><p className="text-sm font-semibold">{formatDate(config.createdAt)}</p></div>
      </CardFrame>
      <CardFrame title="Existing administration surfaces" bodyClassName="flex flex-wrap gap-0.5 p-0.5 text-sm">
        <Link className="button-dark" to="/reports">Open fleet reports</Link>
        <Link className="button-dark" to="/">Open driver application</Link>
      </CardFrame>
      <CardFrame title="Application container" meta={lifecycleAvailable ? lifecycle?.state : 'controller unavailable'} bodyClassName="space-y-1 p-1 text-sm">
        <div className="surface max-w-4xl space-y-0.5 p-1 text-slate-300">
          <p>{lifecycleAvailable ? updateSummary : 'Container updates are unavailable until the lifecycle service is running.'}</p>
          {lifecycle?.message ? <p className="text-slate-400">{lifecycle.message}</p> : null}
          {lifecycle?.rollback ? <p>Rollback: {lifecycle.rollback.status}{lifecycle.rollback.error ? ` — ${lifecycle.rollback.error}` : ''}</p> : null}
          {lifecycleError ? <p className="text-red-300">{lifecycleError}</p> : null}
        </div>
        <div className="flex flex-wrap gap-0.5">
          <button type="button" className="button-dark" disabled={!lifecycleAvailable || lifecycleBusy} onClick={checkForUpdate}>
            {lifecycle?.operation === 'check' && lifecycleBusy ? 'Checking for update…' : 'Check for update'}
          </button>
          <button type="button" className="button-danger" disabled={!lifecycleAvailable || lifecycleBusy} onClick={update}>
            {lifecycle?.operation === 'update' && lifecycleBusy ? 'Updating application…' : 'Update and restart'}
          </button>
          <button type="button" className="button-danger" disabled={restartRequested || lifecycleBusy} onClick={restart}>
            {restartRequested ? 'Waiting for application…' : 'Restart application'}
          </button>
        </div>
      </CardFrame>
      <CardFrame title="Configuration revisions" meta={snapshot.revisions.length} bodyClassName="max-h-64 overflow-y-auto p-0.5 text-xs">
        {snapshot.revisions.map((revision) => (
          <div key={revision.revision} className="surface mb-0.5 grid items-center gap-0.5 p-0.5 md:grid-cols-[5rem_1fr_1fr_1fr_auto]">
            <span>#{revision.revision}</span><span>{formatDate(revision.createdAt)}</span><span>{revision.actor}</span><span>{revision.source}</span>
            <button type="button" className="button-dark text-xs" disabled={revision.revision === config.revision} onClick={() => restore(revision.revision)}>Restore</button>
          </div>
        ))}
      </CardFrame>
      <CardFrame title="Persistent audit history" meta={snapshot.auditEvents.length} bodyClassName="max-h-96 overflow-y-auto p-0.5 text-xs">
        {snapshot.auditEvents.map((event) => (
          <div key={event.id} className="surface mb-0.5 grid gap-0.5 p-0.5 md:grid-cols-[10rem_10rem_1fr]">
            <span>{formatDate(event.createdAt)}</span><span>{event.actor}</span><span>{event.action}</span>
          </div>
        ))}
      </CardFrame>
    </div>
  );
}
