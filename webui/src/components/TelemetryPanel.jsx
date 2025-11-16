import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';

function formatMetric(value, fallback = '--') {
  if (value == null || value === '') return fallback;
  return value;
}

export default function TelemetryPanel() {
  const { session } = useSession();
  const roverId = session?.assignment?.roverId;
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const voltage = sensors.voltageMv != null ? (sensors.voltageMv / 1000).toFixed(2) : null;
  const current = sensors.currentMa != null ? (sensors.currentMa / 1000).toFixed(2) : null;
  const charge = sensors.batteryChargeMah;
  const capacity = sensors.batteryCapacityMah;
  const updated = frame?.receivedAt ? new Date(frame.receivedAt).toLocaleTimeString() : null;
  const rawSnippet = frame?.raw ? (frame.raw.length > 80 ? `${frame.raw.slice(0, 80)}…` : frame.raw) : null;

  return (
    <section className="rounded-lg border border-slate-900 bg-slate-950/70 p-2 text-[0.8rem] text-slate-200">
      <div className="flex items-center justify-between text-[0.65rem] uppercase tracking-[0.3em] text-slate-500">
        <span>Telemetry</span>
        <span>{updated ? `Updated ${updated}` : 'waiting'}</span>
      </div>
      {!roverId ? (
        <p className="mt-2 text-[0.75rem] text-slate-400">Assignment required to view sensors.</p>
      ) : !frame ? (
        <p className="mt-2 text-[0.75rem] text-slate-400">No sensor frames yet.</p>
      ) : (
        <div className="mt-2 space-y-2">
          <Metric label="Charge" value={formatMetric(charge != null && capacity != null ? `${charge}/${capacity} mAh` : null)} />
          <Metric label="Charging" value={formatMetric(sensors.chargingState?.label)} />
          <Metric label="OI Mode" value={formatMetric(sensors.oiMode?.label)} />
          <Metric label="Voltage" value={formatMetric(voltage ? `${voltage} V` : null)} />
          <Metric label="Current" value={formatMetric(current ? `${current} A` : null)} />
        </div>
      )}
      {rawSnippet && (
        <pre className="mt-2 overflow-hidden rounded border border-slate-800 bg-black/60 p-1 text-[0.6rem] text-lime-300">
          {rawSnippet}
        </pre>
      )}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="flex items-center justify-between text-[0.75rem]">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-200">{value}</span>
    </div>
  );
}
