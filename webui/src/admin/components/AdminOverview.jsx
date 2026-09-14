// Administration Overview
// Purpose: Summarizes configuration state, revision history, audit history, and links to existing health/report surfaces.
// Scope: Presents persisted administration metadata without duplicating operational service implementations.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CardFrame from '../../components/CardFrame/index.jsx';
import { restartApplication, restoreConfigurationRevision } from '../api.js';

function formatDate(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleString() : 'unknown';
}

export default function AdminOverview({ snapshot, socket, runSensitive, onSnapshot }) {
  const config = snapshot.configuration;
  const [restartRequested, setRestartRequested] = useState(false);

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
      <CardFrame title="Application" bodyClassName="space-y-0.5 p-1 text-sm">
        <p className="text-slate-300">Restart only the MultiRover application. The process supervisor starts it again automatically without rebooting the host.</p>
        <button type="button" className="button-danger" disabled={restartRequested} onClick={restart}>
          {restartRequested ? 'Waiting for application…' : 'Restart application'}
        </button>
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
