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
  // const rawSnippet = frame?.raw ? (frame.raw.length > 80 ? `${frame.raw.slice(0, 80)}…` : frame.raw) : null;
  const rawSnippet = frame?.raw ? frame.raw : null;
  const roster = session?.roster ?? [];
  const activeDriverId = roverId ? session?.activeDrivers?.[roverId] : null;
  const driverLabel = !roverId
    ? 'n/a'
    : activeDriverId
    ? activeDriverId === session?.socketId
      ? 'You'
      : activeDriverId.slice(0, 6)
    : 'Available';
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
    <section className="panel-section space-y-0.5 text-base text-slate-100">
      <div className="text-sm text-slate-400">
        <span>{connected ? 'online' : 'offline'}</span>
        <span> · role {session?.role || 'unknown'}</span>
        <span> · mode {session?.mode || '--'}</span>
        {updated && <span> · sensors {updated}</span>}
        <span> · driver {driverLabel}</span>
      </div>
      {!roverId ? (
        <p className="text-sm text-slate-500">Assign a rover to view sensors.</p>
      ) : !frame ? (
        <p className="text-sm text-slate-500">Waiting for sensor frames…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-0.5 text-sm">
            <Metric label="Charge" value={formatMetric(charge != null && capacity != null ? `${charge}/${capacity}` : null)} />
            <Metric label="Charging" value={formatMetric(sensors.chargingState?.label)} />
            <Metric label="OI mode" value={formatMetric(sensors.oiMode?.label)} />
            <Metric label="Voltage" value={formatMetric(voltage)} />
            <Metric label="Current" value={formatMetric(current)} />
            <Metric label="Left Encoder" value={formatMetric(sensors.encoderCountsLeft)} />
            <Metric label="Right Encoder" value={formatMetric(sensors.encoderCountsRight)} />
          </div>
          <div className="flex gap-0.5">
            <CliffBar value={sensors.cliffLeftSignal} />
            <CliffBar value={sensors.cliffFrontLeftSignal} />
            <CliffBar value={sensors.cliffFrontRightSignal} />
            <CliffBar value={sensors.cliffRightSignal} />
          </div>
          <MotorCurrentBar label="Left Wheel" value={sensors.wheelLeftCurrentMa} overcurrent={sensors.wheelOvercurrents.leftWheel}/>
        </>

      )}



      {rawSnippet && (
        // console.log('rawSnippet:', rawSnippet),
        <pre className="surface whitespace-pre-wrap break-words text-xs text-lime-300">
          {rawSnippet}
        </pre>
      )}
      <div className="space-y-0.5">
        <p className="text-sm text-slate-400">Rovers</p>
        {roster.length === 0 ? (
          // if there ARE NO rovers
          <p className="text-sm text-slate-500">No roster data.</p>
        ) : (
          // if there ARE rovers
          <ul className="space-y-0.5 text-sm">
            {roster.map((rover) => (
              <li key={rover.id} className="surface flex items-center justify-between gap-0.5">
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
                    className="button-dark disabled:opacity-40"
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

function CliffBar({ value }) {
  // Render a small vertical bar; value is clamped to 0-100 for display
  // const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  // goes from 0 to 4095. calculate percentage for height
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / 4095) * 100));
  const height = `${pct}%`;
  return (
    <div className="surface-muted h-6 w-1/4">
      <div className="w-full bg-amber-500" style={{ height }} />
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="surface text-sm">
      {label}: {value}
    </div>
  );
}

// a reusable motor current bar, with overcurrent coloring. Use the overcurrent from sensors for each motor.
// include a label to indicate which motor it is, with the label to the left of the bar
function MotorCurrentBar({ label, value, overcurrent }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / 5000) * 100));
  const height = `${pct}%`;
  const barColor = overcurrent ? 'bg-red-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-sm text-slate-200">{label}</span>
      <div className="surface-muted h-6 w-20">
        <div className={barColor} style={{ height }} />
      </div>
    </div>
  );
}