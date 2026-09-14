// Administration Overview
// Purpose: Summarizes configuration state, revision history, audit history, and links to existing health/report surfaces.
// Scope: Presents persisted administration metadata without duplicating operational service implementations.
import { Link } from 'react-router-dom';
import CardFrame from '../../components/CardFrame/index.jsx';
import { restoreConfigurationRevision } from '../api.js';

function formatDate(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleString() : 'unknown';
}

export default function AdminOverview({ snapshot, socket, runSensitive, onSnapshot }) {
  const config = snapshot.configuration;

  async function restore(revision) {
    if (!window.confirm(`Restore configuration revision ${revision}? This creates a new active revision and requires a restart.`)) return;
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
