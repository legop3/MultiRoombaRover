// Top-right Corner Pod
// Purpose: Combines the battery/current gauge with a compact attached advanced-power expansion.
import { createElement, useMemo } from 'react';
import { FaArrowDown, FaArrowUp, FaBatteryHalf, FaBolt, FaExclamationTriangle, FaMemory, FaMicrochip, FaThermometerHalf, FaWifi } from 'react-icons/fa';
import { useSessionSelector } from '../../../../context/SessionContext.jsx';
import { useVisualTelemetrySelector } from '../../../../context/TelemetryContext.jsx';
import { hostStatsEqual, selectHostStats, selectSpectatorTelemetry, spectatorTelemetryEqual } from '../../../../context/telemetryViews.js';
import CornerPodToggle from './CornerPodToggle.jsx';
import ExpansionPanel from './ExpansionPanel.jsx';
import usePodVisibility from './usePodVisibility.js';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = finite(value);
  return number == null ? 0 : Math.max(0, Math.min(100, number));
}

function formatMemoryUsage(totalKb, availableKb, usedPercent) {
  const total = finite(totalKb);
  const available = finite(availableKb);
  const percent = finite(usedPercent);
  if (total == null || available == null || percent == null) return percent == null ? '--' : `${Math.round(percent)}%`;

  const used = Math.max(0, total - available);
  const useGigabytes = total >= 1024 * 1024;
  const divisor = useGigabytes ? 1024 * 1024 : 1024;
  const decimals = useGigabytes ? 1 : 0;
  const unit = useGigabytes ? 'GB' : 'MB';
  return `${Math.round(percent)}% · ${(used / divisor).toFixed(decimals)}/${(total / divisor).toFixed(decimals)} ${unit}`;
}

function MetricRow({ icon, label, value, percent, iconClass, fillClass }) {
  return (
    <div className="min-w-0" title={label}>
      <div className="flex items-center gap-1">
        {createElement(icon, { className: `shrink-0 text-[0.65rem] ${iconClass}`, 'aria-hidden': true })}
        <span className="min-w-0 flex-1 truncate text-[0.62rem] leading-none text-slate-200">{label}</span>
        <strong className="shrink-0 text-[0.62rem] leading-none text-white">{value}</strong>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${clampPercent(percent)}%` }} />
      </div>
    </div>
  );
}

function WifiTile({ signal, ssid }) {
  const bars = signal == null ? 0 : signal >= -55 ? 4 : signal >= -65 ? 3 : signal >= -75 ? 2 : 1;
  const tone = signal == null ? 'bg-slate-600' : signal < -80 ? 'bg-red-400' : signal < -70 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="min-w-0" title="Wi-Fi signal strength">
      <div className="flex items-center gap-1">
        <FaWifi className={`text-[0.65rem] ${signal == null ? 'text-slate-400' : 'text-emerald-300'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[0.62rem] leading-none text-slate-200">Wi-Fi signal</span>
        <strong className="shrink-0 text-[0.62rem] leading-none text-white">{signal == null ? '--' : `${Math.round(signal)} dBm`}</strong>
      </div>
      <div className="mt-1 truncate text-[0.68rem] font-semibold leading-none text-white">Wi-Fi: {ssid || '--'}</div>
      <div className="mt-1 flex h-2 items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span key={bar} className={`flex-1 rounded-xs ${bar <= bars ? tone : 'bg-slate-700'}`} style={{ height: `${25 * bar}%` }} />
        ))}
      </div>
    </div>
  );
}

function SpeedTile({ icon, label, value, colorClass }) {
  return (
    <div className="flex min-w-0 items-center gap-1" title={label}>
      {createElement(icon, { className: colorClass, 'aria-hidden': true })}
      <span className="min-w-0 flex-1 truncate text-[0.62rem] leading-none text-slate-200">{label}</span>
      <strong className="shrink-0 text-[0.62rem] leading-none text-white">{value}</strong>
    </div>
  );
}

export default function TopRightPod({ roverId }) {
  const [batteryOpen, setBatteryOpen] = usePodVisibility('battery', true);
  const [powerOpen, setPowerOpen] = usePodVisibility('advancedPower', false);
  const batteryState = useSessionSelector((state) => {
    const rover = (state.session?.roster || []).find((entry) => String(entry.id) === String(roverId));
    return rover?.batteryState || null;
  });
  // These values drive gauges and informational bars only; no control decision
  // depends on their render cadence. The visual subscription remains immediate
  // on desktop while honoring MobileLayoutFrame's shared telemetry throttle on
  // phones, preventing analog current/voltage noise from repainting this pod at
  // the rover sensor-stream rate.
  const electrical = useVisualTelemetrySelector(roverId, selectSpectatorTelemetry, spectatorTelemetryEqual);
  const host = useVisualTelemetrySelector(powerOpen ? roverId : null, selectHostStats, hostStatsEqual);
  const percent = Math.max(0, Math.min(100, finite(batteryState?.percentDisplay) ?? 0));
  const current = finite(electrical?.currentMa) ?? 0;
  const currentPercent = Math.max(0, Math.min(1, Math.abs(current) / 2500));
  const urgentBattery = Boolean(batteryState?.urgentActive);
  const lowBattery = Boolean(batteryState?.warnActive || urgentBattery);
  // Warning and urgent are separate server-owned thresholds. Amber gives the first threshold
  // a clear but calm identity; red is reserved for the genuinely time-sensitive state.
  const batteryTone = urgentBattery ? '#ef4444' : lowBattery ? '#f59e0b' : '#22c55e';
  const currentTone = current < 0 ? '#f59e0b' : '#22c55e';
  const circumference = 2 * Math.PI * 42;
  const currentCircumference = 2 * Math.PI * 32;
  const batteryDash = useMemo(() => `${(percent / 100) * circumference} ${circumference}`, [circumference, percent]);
  const wifi = host?.wifi || {};
  const signal = finite(wifi.signalDbm);
  const voltage = finite(electrical?.voltageMv);
  const batteryCharge = finite(electrical?.batteryChargeMah);
  const batteryCapacity = finite(electrical?.batteryCapacityMah);
  const cpuTemp = finite(host?.cpuTempC);
  const cpuUsed = finite(host?.cpuUsedPct);
  const memoryUsed = finite(host?.memoryUsedPct);
  const memoryUsage = formatMemoryUsage(host?.memoryTotalKb, host?.memoryAvailableKb, memoryUsed);
  const voltagePercent = voltage == null ? 0 : ((voltage - 12000) / 5000) * 100;
  const batteryMahPercent = batteryCharge != null && batteryCapacity > 0 ? (batteryCharge / batteryCapacity) * 100 : 0;
  const cpuTempPercent = cpuTemp == null ? 0 : ((cpuTemp - 30) / 55) * 100;
  const cpuTempTone = cpuTemp >= 80 ? 'bg-red-400' : cpuTemp >= 70 ? 'bg-amber-400' : 'bg-emerald-400';
  const cpuTone = cpuUsed >= 90 ? 'bg-red-400' : cpuUsed >= 70 ? 'bg-amber-400' : 'bg-sky-400';
  const memoryTone = memoryUsed >= 90 ? 'bg-red-400' : memoryUsed >= 75 ? 'bg-amber-400' : 'bg-violet-400';
  const download = finite(wifi.downloadMbps);
  const upload = finite(wifi.uploadMbps);
  const docked = Boolean(electrical?.homeBase);
  const warningMessage = urgentBattery ? 'BATTERY CRITICAL, DOCK NOW' : 'Battery low, please dock soon.';

  return (
    <>
      <div className="pointer-events-auto absolute right-0 top-0 z-20 flex flex-col items-end">
      {batteryOpen ? (
        <div className="relative flex h-34 w-34 items-center justify-center rounded-bl-[4.25rem] bg-black/60">
          {/* Let the gauge geometry define the visible inset so this pod does not carry an
              extra layer of shell padding that the camera pod does not have. */}
          <svg className="h-34 w-34 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#334155" strokeWidth="9" />
            <circle cx="50" cy="50" r="42" fill="none" stroke={batteryTone} strokeWidth="9" strokeLinecap="round" strokeDasharray={batteryDash} />
            <circle cx="50" cy="50" r="32" fill="none" stroke="#334155" strokeWidth="5" />
            <circle cx="50" cy="50" r="32" fill="none" stroke={currentTone} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${currentPercent * currentCircumference} ${currentCircumference}`} />
          </svg>
          {/* Keeping the icon and value in one centered stack makes the gauge's
              meaning obvious without changing either circular telemetry ring. */}
          <span className="absolute flex flex-col items-center justify-center gap-0.5 text-white">
            {lowBattery ? (
              <FaExclamationTriangle className={urgentBattery ? 'text-lg text-red-300' : 'text-lg text-amber-300'} aria-hidden="true" />
            ) : (
              <FaBatteryHalf className="text-lg" aria-hidden="true" />
            )}
            <strong className="text-xl leading-none">{percent}%</strong>
          </span>
          <CornerPodToggle corner="top-right" expanded label="Hide battery pod" onClick={() => setBatteryOpen(false)} />
        </div>
      ) : (
        <CornerPodToggle corner="top-right" expanded={false} label="Show battery pod" onClick={() => setBatteryOpen(true)} />
      )}

      {/* Advanced power is an independently persisted right-edge expansion. Its own arrow is
          retained when closed, and the whole panel moves into the corner if the pod closes. */}
      <ExpansionPanel
        open={powerOpen}
        onOpenChange={setPowerOpen}
        anchorClassName={`absolute right-0 ${batteryOpen ? 'top-34' : 'top-10'}`}
        panelAlign="right"
        panelClassName="w-56 rounded-bl-xl bg-black/60 p-1.5 pt-4 text-white"
        openDirection="left"
        closeDirection="right"
        openLabel="Show power and computer"
        closeLabel="Hide power and computer"
      >
          <div className="space-y-1.5">
            <MetricRow icon={FaBolt} label="Roomba voltage" value={voltage == null ? '--' : `${(voltage / 1000).toFixed(1)} V`} percent={voltagePercent} iconClass="text-sky-300" fillClass="bg-sky-400" />
            <MetricRow icon={FaBolt} label="Roomba current" value={`${current > 0 ? '+' : ''}${Math.round(current)} mA`} percent={currentPercent * 100} iconClass={current < 0 ? 'text-amber-300' : 'text-emerald-300'} fillClass={current < 0 ? 'bg-amber-400' : 'bg-emerald-400'} />
            <MetricRow icon={FaBatteryHalf} label="Battery charge" value={batteryCharge == null || batteryCapacity == null ? '--' : `${Math.round(batteryCharge)} / ${Math.round(batteryCapacity)} mAh`} percent={batteryMahPercent} iconClass="text-emerald-300" fillClass="bg-emerald-400" />
            <MetricRow icon={FaThermometerHalf} label="Computer temperature" value={cpuTemp == null ? '--' : `${cpuTemp.toFixed(1)} C`} percent={cpuTempPercent} iconClass={cpuTemp >= 80 ? 'text-red-300' : cpuTemp >= 70 ? 'text-amber-300' : 'text-emerald-300'} fillClass={cpuTempTone} />
            <MetricRow icon={FaMicrochip} label="CPU usage" value={cpuUsed == null ? '--' : `${Math.round(cpuUsed)}%`} percent={cpuUsed} iconClass={cpuUsed >= 90 ? 'text-red-300' : cpuUsed >= 70 ? 'text-amber-300' : 'text-sky-300'} fillClass={cpuTone} />
            <MetricRow icon={FaMemory} label="Memory usage" value={memoryUsage} percent={memoryUsed} iconClass={memoryUsed >= 90 ? 'text-red-300' : memoryUsed >= 75 ? 'text-amber-300' : 'text-violet-300'} fillClass={memoryTone} />
            <WifiTile signal={signal} ssid={wifi.ssidSample} />
            <SpeedTile icon={FaArrowDown} label="Download speed" value={download == null ? '--' : `${download.toFixed(1)} Mb/s`} colorClass="text-sky-300" />
            <SpeedTile icon={FaArrowUp} label="Upload speed" value={upload == null ? '--' : `${upload.toFixed(1)} Mb/s`} colorClass="text-violet-300" />
          </div>
      </ExpansionPanel>
      </div>

      {/* Battery danger is a stage-level warning, so it belongs near the user's focus instead
          of beside the corner gauge. It deliberately has only two stable messages and no
          animation; severity comes from its size and solid color rather than visual noise. */}
      {lowBattery && !docked ? (
        <div
          className={`pointer-events-none absolute left-1/2 top-[58%] z-55 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap px-4 py-2 font-bold text-white shadow-xl ${
            urgentBattery ? 'bg-red-950 text-xl' : 'bg-amber-950 text-base'
          }`}
          role="alert"
        >
          <FaExclamationTriangle className={urgentBattery ? 'text-red-300' : 'text-amber-300'} aria-hidden="true" />
          <span>{warningMessage}</span>
        </div>
      ) : null}
    </>
  );
}
