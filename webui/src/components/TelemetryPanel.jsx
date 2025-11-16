import { useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';

function formatMetric(value, fallback = '--') {
  if (value == null || value === '') return fallback;
  return value;
}

export default function TelemetryPanel() {
  const { connected, session, requestControl } = useSession();
  const roverId = session?.assignment?.roverId;
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const voltage = sensors.voltageMv != null ? `${(sensors.voltageMv / 1000).toFixed(2)} V` : null;
  const current = sensors.currentMa != null ? `${sensors.currentMa} mA` : null;
  const charge = sensors.batteryChargeMah;
  const capacity = sensors.batteryCapacityMah;
  const updated = frame?.receivedAt ? new Date(frame.receivedAt).toLocaleTimeString() : null;
  const rawSnippet = frame?.raw ? (frame.raw.length > 80 ? `${frame.raw.slice(0, 80)}…` : frame.raw) : null;
  const roster = session?.roster ?? [];
  const isAdmin = useMemo(
    () => session?.role === 'admin' || session?.role === 'lockdown' || session?.role === 'lockdown-admin',
    [session?.role],
  );
  const [pending, setPending] = useState({});

  async function handleRequest(roverId) {
    if (!roverId) return;
    setPending((prev) => ({ ...prev, [roverId]: true }));
    try {
      await requestControl(roverId);
    } catch (err) {
      alert(err.message);
    } finally {
      setPending((prev) => ({ ...prev, [roverId]: false }));
    }
  }

  return (
    <section className="rounded-sm bg-[#242a32] p-2 text-base text-slate-100">
      <div className="text-sm text-slate-400">
        <span>{connected ? 'online' : 'offline'}</span>
        <span> · role {session?.role || 'unknown'}</span>
        <span> · mode {session?.mode || '--'}</span>
        {updated && <span> · sensors {updated}</span>}
      </div>
      {!roverId ? (
        <p className="mt-1 text-[0.75rem] text-slate-400">Assign a rover to view sensors.</p>
      ) : !frame ? (
        <p className="mt-1 text-[0.75rem] text-slate-400">Waiting for sensor frames…</p>
      ) : (
        <div className="mt-2 space-y-1 text-base">
          <Metric label="Charge" value={formatMetric(charge != null && capacity != null ? `${charge}/${capacity} mAh` : null)} />
          <Metric label="Charging" value={formatMetric(sensors.chargingState?.label)} />
          <Metric label="OI mode" value={formatMetric(sensors.oiMode?.label)} />
          <Metric label="Voltage" value={formatMetric(voltage)} />
          <Metric label="Current" value={formatMetric(current)} />
        </div>
      )}
      {rawSnippet && (
        <pre className="mt-2 overflow-hidden rounded-sm bg-black/60 p-2 text-sm text-lime-300">
          {rawSnippet}
        </pre>
      )}
      <div className="mt-2">
        <p className="text-sm text-slate-400">Rovers</p>
        {roster.length === 0 ? (
          <p className="text-sm text-slate-500">No roster data.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {roster.map((rover) => (
              <li key={rover.id} className="flex items-center justify-between gap-1">
                <div>
                  <p className="text-slate-200">{rover.name}</p>
                  <p className="text-xs text-slate-500">
                    {rover.locked ? 'locked' : 'free'} · {rover.lastSeen ? 'seen' : 'unknown'}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleRequest(rover.id)}
                    disabled={pending[rover.id]}
                    className="rounded-sm bg-black/40 px-2 py-0.5 text-xs text-slate-200 disabled:opacity-40"
                  >
                    {pending[rover.id] ? '...' : 'request'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}
