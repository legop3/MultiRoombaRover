// Admin Ip Log Panel
// Purpose: Defines the Admin Ip Log Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import CardFrame from '../CardFrame/index.jsx';

export default function AdminIpLogPanel({ entries }) {
  const logs = entries || [];
  return (
    <CardFrame title="Admin IP log" meta={logs.length} bodyClassName="space-y-0.5 text-base">
      <div className="h-64 overflow-y-auto font-mono text-xs">
        {logs.length === 0 ? (
          <p>No admin log entries yet.</p>
        ) : (
          logs
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id}>
                <span className="text-amber-400">{entry.ts ? new Date(entry.ts).toLocaleTimeString() : '--'}</span>{' '}
                {entry.label && <span className="text-teal-400">[{entry.label}]</span>}{' '}
                <span className="text-slate-200">{entry.message}</span>{' '}
                {entry.ip && <span className="text-cyan-300">{entry.ip}</span>}{' '}
                {entry.meta && <span className="text-slate-500">{JSON.stringify(entry.meta)}</span>}
              </div>
            ))
        )}
      </div>
      <p className="text-xs text-slate-500">Admin-only log stream; IPs never appear in user data.</p>
    </CardFrame>
  );
}
