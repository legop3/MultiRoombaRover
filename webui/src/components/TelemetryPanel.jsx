import { useMemo } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';

function formatEntries(sensors = {}) {
  return Object.entries(sensors).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : value,
  }));
}

export default function TelemetryPanel() {
  const { session } = useSession();
  const roverId = session?.assignment?.roverId;
  const frame = useTelemetryFrame(roverId);

  const entries = useMemo(() => formatEntries(frame?.sensors), [frame?.sensors]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Telemetry</p>
          <h2 className="text-2xl font-semibold text-white">
            {roverId ? `Rover ${roverId}` : 'No rover assigned'}
          </h2>
        </div>
        <p className="text-sm text-slate-400">
          {frame?.receivedAt ? `Updated ${new Date(frame.receivedAt).toLocaleTimeString()}` : 'Waiting…'}
        </p>
      </header>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          {roverId ? 'No sensor frames yet.' : 'Assignment required to view sensors.'}
        </p>
      ) : (
        <dl className="mt-4 grid gap-3 text-sm text-slate-100">
          {entries.map(({ key, value }) => (
            <div key={key} className="flex justify-between gap-6">
              <dt className="text-slate-500">{key}</dt>
              <dd className="text-right font-semibold text-white">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {frame?.raw && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Raw frame</p>
          <pre className="mt-2 max-h-32 overflow-y-auto rounded-xl bg-slate-950/60 p-3 text-xs text-lime-300">
            {frame.raw}
          </pre>
        </div>
      )}
    </section>
  );
}
