// Log Panel
// Purpose: Defines the Log Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useMemo } from 'react';

export default function LogPanel() {
  const logs = useSessionSelector((state) => state.logs);
  const rendered = useMemo(() => logs.slice().reverse(), [logs]);
  return (
    <div className="panel-section space-y-0.5 text-base">
      <div className="panel-title-row">
        <span className="panel-title-text">Server logs</span>
        <span className="panel-title-meta">{logs.length}</span>
      </div>
      <div className="surface h-64 overflow-y-auto font-mono text-xs">
        {logs.length === 0 ? (
          <p>No logs yet.</p>
        ) : (
          rendered.map((entry) => (
              <div key={entry.id} className="surface">
                <span className="text-amber-400">{entry.timestamp}</span>{' '}
                <span className="text-lime-400">[{entry.level}]</span>{' '}
                {entry.label && <span className="text-teal-400">[{entry.label}]</span>}{' '}
                <span>{entry.message}</span>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
