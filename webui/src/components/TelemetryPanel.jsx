import { useMemo } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';

function formatMetric(value, fallback = '--') {
  if (value == null || value === '') return fallback;
  return value;
}

export default function TelemetryPanel() {
  const { connected, session } = useSession();
  const roverId = session?.assignment?.roverId;
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const voltage = sensors.voltageMv != null ? `${(sensors.voltageMv / 1000).toFixed(2)} V` : null;
  const current = sensors.currentMa != null ? `${sensors.currentMa} mA` : null;
  const batteryTemp = sensors.batteryTemperatureC != null ? `${sensors.batteryTemperatureC} °C` : null;
  const charge = sensors.batteryChargeMah;
  const capacity = sensors.batteryCapacityMah;
  const updated = frame?.receivedAt ? new Date(frame.receivedAt).toLocaleTimeString() : null;
  const rawSnippet = frame?.raw ? frame.raw : null;
  const activeDriverId = roverId ? session?.activeDrivers?.[roverId] : null;
  const driverLabel = useMemo(() => {
    if (!roverId) return 'n/a';
    if (!activeDriverId) return 'Available';
    if (activeDriverId === session?.socketId) return 'You';
    const user = (session?.users || []).find((entry) => entry.socketId === activeDriverId);
    return user?.nickname || activeDriverId.slice(0, 6);
  }, [activeDriverId, roverId, session?.socketId, session?.users]);

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
          <TelemetrySummary sensors={sensors} voltage={voltage} current={current} batteryTemp={batteryTemp} charge={charge} capacity={capacity} />
          <SensorDetails sensors={sensors} />
        </>
      )}
      {rawSnippet && (
        <pre className="surface whitespace-pre-wrap break-words text-xs text-lime-300">{rawSnippet}</pre>
      )}
    </section>
  );
}

function TelemetrySummary({ sensors, voltage, current, batteryTemp, charge, capacity }) {
  const chargePct = charge != null && capacity ? `${Math.round((charge / capacity) * 100)}%` : '--';
  const oiMode = sensors?.oiMode?.label || '--';
  const docked = sensors?.chargingSources?.homeBase ? 'Yes' : 'No';
  const charging = sensors?.chargingState?.label || '--';

  return (
    <div className="grid grid-cols-2 gap-0.5 md:grid-cols-3">
      <Metric label="Voltage" value={voltage ?? '--'} />
      <Metric label="Current" value={current ?? '--'} />
      <Metric label="Battery temp" value={batteryTemp ?? '--'} />
      <Metric label="Charge" value={charge != null ? `${charge} mAh` : '--'} />
      <Metric label="Capacity" value={capacity != null ? `${capacity} mAh` : '--'} />
      <Metric label="Charge %" value={chargePct} />
      <Metric label="OI mode" value={oiMode} />
      <Metric label="Docked" value={docked} />
      <Metric label="Charging state" value={charging} />
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="surface flex items-center justify-between gap-0.5 px-1 py-0.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-100">{value}</span>
    </div>
  );
}

function SensorDetails({ sensors }) {
  const bumps = sensors?.bumpsAndWheelDrops || {};
  const over = sensors?.wheelOvercurrents || {};

  const lightSignals = [
    { label: 'Left', value: sensors?.lightBumpLeftSignal },
    { label: 'Front Left', value: sensors?.lightBumpFrontLeftSignal },
    { label: 'Center Left', value: sensors?.lightBumpCenterLeftSignal },
    { label: 'Center Right', value: sensors?.lightBumpCenterRightSignal },
    { label: 'Front Right', value: sensors?.lightBumpFrontRightSignal },
    { label: 'Right', value: sensors?.lightBumpRightSignal },
  ];

  const cliffSignals = [
    { label: 'Left', value: sensors?.cliffLeftSignal, active: sensors?.cliffLeft },
    { label: 'Front Left', value: sensors?.cliffFrontLeftSignal, active: sensors?.cliffFrontLeft },
    { label: 'Front Right', value: sensors?.cliffFrontRightSignal, active: sensors?.cliffFrontRight },
    { label: 'Right', value: sensors?.cliffRightSignal, active: sensors?.cliffRight },
  ];

  const currents = [
    { label: 'Wheel L', value: sensors?.wheelLeftCurrentMa, over: over.leftWheel },
    { label: 'Wheel R', value: sensors?.wheelRightCurrentMa, over: over.rightWheel },
    { label: 'Side brush', value: sensors?.sideBrushCurrentMa, over: over.sideBrush },
    { label: 'Main brush', value: sensors?.mainBrushCurrentMa, over: over.mainBrush },
  ];

  return (
    <div className="grid gap-0.5 md:grid-cols-2">
      <DetailCard title="Dock IR (raw)">
        <ValueRow label="Left" value={formatNumber(sensors?.infraredCharacterLeft)} />
        <ValueRow label="Omni" value={formatNumber(sensors?.infraredCharacterOmni)} />
        <ValueRow label="Right" value={formatNumber(sensors?.infraredCharacterRight)} />
      </DetailCard>

      <DetailCard title="Bumps & drops">
        <ValueRow label="Bump L" value={<Pill active={bumps.bumpLeft} />} />
        <ValueRow label="Bump R" value={<Pill active={bumps.bumpRight} />} />
        <ValueRow label="Wheel drop L" value={<Pill active={bumps.wheelDropLeft} tone="amber" />} />
        <ValueRow label="Wheel drop R" value={<Pill active={bumps.wheelDropRight} tone="amber" />} />
      </DetailCard>

      <DetailCard title="Light bumps (raw)">
        {lightSignals.map((entry) => (
          <ValueRow key={entry.label} label={entry.label} value={formatNumber(entry.value)} />
        ))}
      </DetailCard>

      <DetailCard title="Cliff sensors">
        {cliffSignals.map((entry) => (
          <ValueRow key={entry.label} label={entry.label} value={`${formatNumber(entry.value)} · ${entry.active ? 'bool: true' : 'bool: false'}`} />
        ))}
      </DetailCard>

      <DetailCard title="Currents">
        {currents.map((entry) => (
          <ValueRow
            key={entry.label}
            label={entry.label}
            value={
              <span className="flex items-center gap-0.5">
                <span>{formatNumber(entry.value, 'mA')}</span>
                {entry.over ? <Pill active tone="red" label="over" /> : null}
              </span>
            }
          />
        ))}
      </DetailCard>

      <DetailCard title="Dirt detect">
        <ValueRow label="Left" value={formatNumber(sensors?.dirtDetectLeft)} />
        <ValueRow label="Right" value={formatNumber(sensors?.dirtDetect)} />
      </DetailCard>
    </div>
  );
}

function DetailCard({ title, children }) {
  return (
    <div className="surface space-y-0.5 p-1 text-sm">
      <div className="text-[0.8rem] uppercase tracking-wide text-slate-400">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ValueRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-slate-300">{label}</span>
      <span className="text-slate-100">{value}</span>
    </div>
  );
}

function Pill({ active, tone = 'green', label }) {
  const base = 'rounded px-1.5 py-0.5 text-[0.7rem] font-semibold';
  const colors =
    tone === 'red'
      ? active
        ? 'bg-red-600 text-white'
        : 'bg-slate-700 text-slate-300'
      : tone === 'amber'
      ? active
        ? 'bg-amber-500 text-slate-900'
        : 'bg-slate-700 text-slate-300'
      : active
      ? 'bg-emerald-600 text-white'
      : 'bg-slate-700 text-slate-300';
  return <span className={`${base} ${colors}`}>{label || (active ? 'true' : 'false')}</span>;
}

function formatNumber(value, unit) {
  if (value == null || Number.isNaN(value)) return '--';
  return unit ? `${value} ${unit}` : value;
}
