export default function SpectatorTelemetryOverlay({ sensors, telemetry = null, mobileHud = false }) {
  const voltageMv = telemetry?.voltageMv ?? sensors?.voltageMv ?? null;
  const currentMa = telemetry?.currentMa ?? sensors?.currentMa ?? null;
  const batteryChargeMah = telemetry?.batteryChargeMah ?? sensors?.batteryChargeMah ?? null;
  const oiLabel = telemetry?.oiModeLabel ?? sensors?.oiMode?.label ?? 'Unknown';
  const docked = telemetry?.homeBase ?? Boolean(sensors?.chargingSources?.homeBase);
  const chargingLabel = telemetry?.chargingStateLabel ?? sensors?.chargingState?.label ?? '';
  const statusPadClass = mobileHud ? 'px-0.25 py-0.25' : 'px-1 py-0.5';
  const telemetryPosClass = mobileHud ? 'left-0.5 top-1/2' : 'left-1 top-1/2';
  const telemetryTextClass = mobileHud ? 'text-[0.45rem]' : 'text-[0.65rem]';
  const telemetryEntries = [
    ['Voltage', voltageMv != null ? `${(voltageMv / 1000).toFixed(2)} V` : '--'],
    ['Current', currentMa != null ? `${currentMa} mA` : '--'],
    ['Charge', batteryChargeMah != null ? `${batteryChargeMah}` : '--'],
    ['Oi', oiLabel || '--'],
  ];
  const charging = Boolean(chargingLabel && chargingLabel.toLowerCase() !== 'not charging');
  const oiNormalized = oiLabel.toLowerCase();
  const oiTone =
    oiNormalized === 'full'
      ? 'bg-emerald-500/80 text-emerald-50'
      : oiNormalized === 'safe'
      ? 'bg-amber-400/80 text-amber-950'
      : oiNormalized === 'passive'
      ? 'bg-slate-700/80 text-slate-100'
      : 'bg-slate-700/60 text-slate-200';
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
          <span className={`rounded px-1.5 py-0.5 ${dockTone}`}>{docked ? 'Docked' : 'Undocked'}</span>
          <span className={`rounded px-1.5 py-0.5 ${chargingTone}`}>
            {charging ? 'Charging' : docked ? 'Not charging' : 'Not charging'}
          </span>
          <span className={`rounded px-1.5 py-0.5 ${oiTone}`}>Oi: {oiLabel}</span>
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
