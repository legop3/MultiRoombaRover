export default function SpectatorTelemetryOverlay({ sensors, telemetry = null, mobileHud = false }) {
  const voltageMv = telemetry?.voltageMv ?? sensors?.voltageMv ?? null;
  const currentMa = telemetry?.currentMa ?? sensors?.currentMa ?? null;
  const batteryChargeMah = telemetry?.batteryChargeMah ?? sensors?.batteryChargeMah ?? null;
  const driving = telemetry?.drivingMode ?? null;
  const modeLabel = driving == null ? 'Unknown' : driving ? 'Driving' : 'Not driving';
  const docked = telemetry?.homeBase ?? null;
  const charging = telemetry?.charging ?? null;
  const statusPadClass = mobileHud ? 'px-0.25 py-0.25' : 'px-1 py-0.5';
  const telemetryPosClass = mobileHud ? 'left-0.5 top-1/2' : 'left-1 top-1/2';
  const telemetryTextClass = mobileHud ? 'text-[0.45rem]' : 'text-[0.65rem]';
  const telemetryEntries = [
    ['Voltage', voltageMv != null ? `${(voltageMv / 1000).toFixed(2)} V` : '--'],
    ['Current', currentMa != null ? `${currentMa} mA` : '--'],
    ['Charge', batteryChargeMah != null ? `${batteryChargeMah}` : '--'],
    ['Mode', modeLabel],
  ];
  const modeTone = driving === true
    ? 'bg-emerald-500/80 text-emerald-50'
    : 'bg-slate-700/70 text-slate-200';
  const dockTone = docked ? 'bg-emerald-500/80 text-emerald-50' : 'bg-slate-700/70 text-slate-200';
  const chargingTone = charging
    ? 'bg-emerald-500/80 text-emerald-50'
    : docked
    ? 'bg-amber-400/80 text-amber-950'
    : 'bg-slate-700/70 text-slate-200';

  return (
    <div
      className={`absolute ${telemetryPosClass} flex -translate-y-1/2 flex-col gap-0.5 bg-black/70 text-slate-100 ${telemetryTextClass} ${statusPadClass}`}
    >
      <div className="space-y-0.5 leading-tight">
        <div className="flex flex-col gap-0.5 text-[0.75rem] font-semibold uppercase tracking-wide">
          <span className={`rounded-sm px-1.5 py-0.5 ${dockTone}`}>{docked == null ? 'Dock unknown' : docked ? 'Docked' : 'Undocked'}</span>
          <span className={`rounded-sm px-1.5 py-0.5 ${chargingTone}`}>
            {charging == null ? 'Charging unknown' : charging ? 'Charging' : 'Not charging'}
          </span>
          <span className={`rounded-sm px-1.5 py-0.5 ${modeTone}`}>{modeLabel}</span>
        </div>
        {telemetryEntries.map(([labelText, value]) => (
          <span key={labelText} className="flex items-center justify-between gap-0.5">
            <span className="text-slate-400">{labelText}</span>
            <span className="font-semibold text-white">{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
