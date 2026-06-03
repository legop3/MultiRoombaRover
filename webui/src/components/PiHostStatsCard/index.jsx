// Pi Host Stats Card
// Purpose: Renders Raspberry Pi host health for the assigned rover. Scope: Uses the separate roverHostStats stream, not Roomba sensorFrame data.
import CardFrame from '../CardFrame/index.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useTelemetryFrame } from '../../context/TelemetryContext.jsx';

const EMPTY_STATS = Object.freeze({});
const EMPTY_WIFI = Object.freeze({});
const PLACEHOLDER_STATS = Object.freeze({
  uptimeSec: 12840,
  cpuTempC: 74.2,
  cpuUsedPct: 80,
  coreVoltageV: 0.5,
  loadAvg1m: 0.42,
  memoryTotalKb: 948000,
  memoryAvailableKb: 417120,
  memoryUsedPct: 100,
  diskTotalBytes: 31200000000,
  diskFreeBytes: 8736000000,
  diskUsedPct: 72,
  undervoltageNow: true,
  undervoltageSeen: true,
  frequencyCappedNow: false,
  frequencyCappedSeen: true,
  throttledNow: false,
  throttledSeen: false,
  softTempLimitNow: false,
  softTempLimitSeen: false,
  wifi: Object.freeze({
    ssidSample: 'BsmnRvrNt',
    frequencyMhz: 2412,
    signalDbm: -45,
    quality: 10,
    qualityMax: 70,
    rxBitrateMbit: 72.2,
    txBitrateMbit: 58.5,
    rxBytes: 12400000,
    txBytes: 2300000,
    rxPackets: 12640,
    txPackets: 6840,
  }),
});

function valueOrDash(value) {
  return value == null || value === '' ? '--' : value;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampPercent(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;
  return Math.max(0, Math.min(100, numeric));
}

function thresholdTone(value, warnAt, badAt) {
  const numeric = finiteNumber(value);
  if (numeric == null) return 'neutral';
  if (numeric >= badAt) return 'bad';
  if (numeric >= warnAt) return 'warn';
  return 'good';
}

function toneTextClass(tone) {
  if (tone === 'bad') return 'text-red-400';
  if (tone === 'warn') return 'text-yellow-400';
  if (tone === 'good') return 'text-white';
  return 'text-slate-100';
}

function toneFillClass(tone) {
  if (tone === 'bad') return 'bg-red-500';
  if (tone === 'warn') return 'bg-yellow-500';
  if (tone === 'good') return 'bg-white';
  return 'bg-slate-300';
}

function formatPercent(value) {
  const numeric = finiteNumber(value);
  return numeric == null ? '--' : `${Math.round(numeric)}%`;
}

function formatTemp(value) {
  const numeric = finiteNumber(value);
  return numeric == null ? '--' : `${numeric.toFixed(1)} C`;
}

function formatVoltage(value) {
  const numeric = finiteNumber(value);
  return numeric == null ? '--' : `${numeric.toFixed(3)} V`;
}

function formatDbm(value) {
  const numeric = finiteNumber(value);
  return numeric == null ? '--' : `${Math.round(numeric)} dBm`;
}

function formatFrequency(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return '--';
  return `${Math.round(numeric)} MHz`;
}

function formatBitrate(value) {
  const numeric = finiteNumber(value);
  return numeric == null ? '--' : `${numeric.toFixed(numeric >= 100 ? 0 : 1)} Mb/s`;
}

function formatBytes(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let scaled = numeric;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatMemoryKb(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return '--';
  return formatBytes(numeric * 1024);
}

function formatUsedTotal(used, total, formatter) {
  const usedValue = finiteNumber(used);
  const totalValue = finiteNumber(total);
  if (usedValue == null || totalValue == null) return '--';
  return `${formatter(usedValue)} / ${formatter(totalValue)}`;
}

function memoryUsedKb(stats) {
  const total = finiteNumber(stats.memoryTotalKb);
  const available = finiteNumber(stats.memoryAvailableKb);
  if (total == null || available == null) return null;
  return Math.max(0, total - available);
}

function diskUsedBytes(stats) {
  const total = finiteNumber(stats.diskTotalBytes);
  const free = finiteNumber(stats.diskFreeBytes);
  if (total == null || free == null) return null;
  return Math.max(0, total - free);
}

function formatUptime(seconds) {
  const numeric = finiteNumber(seconds);
  if (numeric == null) return '--';
  const total = Math.max(0, Math.floor(numeric));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function wifiQualityPercent(wifi) {
  const quality = finiteNumber(wifi?.quality);
  const max = finiteNumber(wifi?.qualityMax);
  if (quality == null || !max) return null;
  return (quality / max) * 100;
}

function tempPercent(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;

  // Raspberry Pi thermal behavior becomes interesting long before the hard
  // throttle point, so the meter maps a practical 30-85 C operating range
  // instead of using 0-100 C where normal values would barely move.
  return ((numeric - 30) / (85 - 30)) * 100;
}

function tempTone(value) {
  return thresholdTone(value, 70, 80);
}

function signalBars(signalDbm) {
  const numeric = finiteNumber(signalDbm);
  if (numeric == null) return 0;
  if (numeric >= -55) return 4;
  if (numeric >= -65) return 3;
  if (numeric >= -75) return 2;
  return 1;
}

function signalTone(signalDbm) {
  const numeric = finiteNumber(signalDbm);
  if (numeric == null) return 'neutral';
  if (numeric >= -55) return 'good';
  if (numeric >= -70) return 'neutral';
  if (numeric >= -80) return 'warn';
  return 'bad';
}

function powerStatus(stats) {
  // Current throttle flags are more important than historical flags because
  // they describe active power or thermal limits. Historical flags are still
  // surfaced as "seen" so they remain useful without overstating urgency.
  if (stats.undervoltageNow) return 'Undervoltage';
  if (stats.throttledNow) return 'Throttled';
  if (stats.frequencyCappedNow) return 'Freq capped';
  if (stats.softTempLimitNow) return 'Soft temp';
  if (stats.undervoltageSeen || stats.throttledSeen || stats.frequencyCappedSeen || stats.softTempLimitSeen) return 'Seen';
  return 'OK';
}

function powerTone(stats) {
  if (stats.undervoltageNow || stats.throttledNow || stats.frequencyCappedNow || stats.softTempLimitNow) return 'bad';
  if (stats.undervoltageSeen || stats.throttledSeen || stats.frequencyCappedSeen || stats.softTempLimitSeen) return 'warn';
  return 'good';
}

function formatPacketCount(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return '--';
  if (numeric >= 1000000) return `${(numeric / 1000000).toFixed(1)}m`;
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(1)}k`;
  return `${Math.round(numeric)}`;
}

function formatTraffic(bytes, packets) {
  return `${formatBytes(bytes)} / ${formatPacketCount(packets)}`;
}

function warningMessages(stats) {
  const messages = [];

  // Current warnings are listed first because they need immediate attention;
  // historical flags still matter, but they are lower urgency.
  if (stats.undervoltageNow) messages.push('undervoltage now');
  if (stats.throttledNow) messages.push('throttled now');
  if (stats.frequencyCappedNow) messages.push('frequency capped now');
  if (stats.softTempLimitNow) messages.push('soft temp limit now');
  if (!stats.undervoltageNow && stats.undervoltageSeen) messages.push('undervoltage seen');
  if (!stats.throttledNow && stats.throttledSeen) messages.push('throttled seen');
  if (!stats.frequencyCappedNow && stats.frequencyCappedSeen) messages.push('frequency cap seen');
  if (!stats.softTempLimitNow && stats.softTempLimitSeen) messages.push('soft temp limit seen');

  return messages;
}

export default function PiHostStatsCard() {
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const frame = useTelemetryFrame(roverId);
  const stats = frame?.hostStats || PLACEHOLDER_STATS;
  const wifi = stats.wifi || EMPTY_WIFI;
  const warnings = warningMessages(stats);
  const wifiQuality = wifiQualityPercent(wifi);
  const bars = signalBars(wifi.signalDbm);
  const memoryUsed = memoryUsedKb(stats);
  const diskUsed = diskUsedBytes(stats);
  const currentPowerTone = powerTone(stats);
  const currentTempTone = tempTone(stats.cpuTempC);
  const currentSignalTone = signalTone(wifi.signalDbm);

  return (
    <CardFrame title="Rover Pi Stats" clipOverflow={false} bodyClassName="space-y-0.5 text-sm text-slate-100">
      <div className="grid gap-0.5 md:grid-cols-[0.9fr_1fr_1.3fr]">
        <section className="min-w-0 space-y-0.5">
          <ColumnTitle label="Power info" />
          <div className="surface">
            <div className="mb-0.5 flex items-baseline justify-between gap-1">
              <span className="text-slate-400">CPU Temp</span>
              <span className={`leading-none ${toneTextClass(currentTempTone)}`}>{formatTemp(stats.cpuTempC)}</span>
            </div>
            <Meter percent={tempPercent(stats.cpuTempC)} tone={currentTempTone} />
          </div>
          <StatRow label="Core Voltage" value={formatVoltage(stats.coreVoltageV)} />
          <StatRow label="Uptime" value={formatUptime(stats.uptimeSec)} />
          <StatRow label="Power" value={powerStatus(stats)} valueClassName={toneTextClass(currentPowerTone)} />
        </section>

        <section className="min-w-0 space-y-0.5">
          <ColumnTitle label="Resources" />
          <BarRow
            label="CPU Usage"
            value={formatPercent(stats.cpuUsedPct)}
            percent={stats.cpuUsedPct}
            tone={thresholdTone(stats.cpuUsedPct, 70, 90)}
          />
          <BarRow
            label="Memory Usage"
            value={formatPercent(stats.memoryUsedPct)}
            detail={formatUsedTotal(memoryUsed, stats.memoryTotalKb, formatMemoryKb)}
            percent={stats.memoryUsedPct}
            tone={thresholdTone(stats.memoryUsedPct, 75, 90)}
          />
          <BarRow
            label="Disk Usage"
            value={formatPercent(stats.diskUsedPct)}
            detail={formatUsedTotal(diskUsed, stats.diskTotalBytes, formatBytes)}
            percent={stats.diskUsedPct}
            tone={thresholdTone(stats.diskUsedPct, 80, 92)}
          />
        </section>

        <section className="min-w-0 space-y-0.5">
          <ColumnTitle label="WiFi" />
          <div className="surface grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-1">
            <div className="min-w-0">
              <div className="truncate text-base leading-tight text-slate-100">SSID: {valueOrDash(wifi.ssidSample)}</div>
              <div className="text-xs text-slate-400">{formatFrequency(wifi.frequencyMhz)}</div>
            </div>
            <div className="text-right">
              <div className={`font-semibold leading-tight ${toneTextClass(currentSignalTone)}`}>{formatDbm(wifi.signalDbm)}</div>
              <SignalBars bars={bars} tone={currentSignalTone} />
            </div>
          </div>
          <BarRow
            label="Link Quality"
            value={wifi.quality == null ? '--' : `${wifi.quality}/${valueOrDash(wifi.qualityMax)}`}
            percent={wifiQuality}
            tone={currentSignalTone}
          />
          <div className="grid grid-cols-2 gap-0.5">
            <StatRow label="RX rate" value={formatBitrate(wifi.rxBitrateMbit)} compact />
            <StatRow label="TX rate" value={formatBitrate(wifi.txBitrateMbit)} compact />
            <StatRow label="RX" value={formatTraffic(wifi.rxBytes, wifi.rxPackets)} compact />
            <StatRow label="TX" value={formatTraffic(wifi.txBytes, wifi.txPackets)} compact />
          </div>
        </section>
      </div>

      {warnings.length ? <div className="surface text-xs text-amber-200">{warnings.join(' · ')}</div> : null}
    </CardFrame>
  );
}

function ColumnTitle({ label }) {
  return <div className="text-[0.7rem] font-semibold tracking-wide text-slate-400">{label}</div>;
}

function StatRow({ label, value, compact = false, valueClassName = 'text-slate-100' }) {
  return (
    <div className={`surface flex min-w-0 items-center justify-between gap-1 ${compact ? 'text-xs' : ''}`}>
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className={`min-w-0 truncate text-right ${valueClassName}`}>{value}</span>
    </div>
  );
}

function BarRow({ label, value, detail = null, percent, tone = 'neutral' }) {
  return (
    <div className="surface">
      <div className="mb-0.5 flex items-center justify-between gap-1">
        <span className="text-slate-400">{label}</span>
        <span className={`min-w-0 truncate text-right ${toneTextClass(tone)}`}>
          {detail ? `${value}: ${detail}` : value}
        </span>
      </div>
      <Meter percent={percent} tone={tone} />
    </div>
  );
}

function Meter({ percent, tone = 'neutral' }) {
  const width = clampPercent(percent);

  return (
    <div className="h-1 bg-neutral-700">
      {/* The fill width is the visual data encoding; when data is missing the
          track remains visible but empty so the layout can be reviewed in dev. */}
      <div className={`h-full ${toneFillClass(tone)}`} style={{ width: width == null ? '0%' : `${width}%` }} />
    </div>
  );
}

function SignalBars({ bars, tone = 'neutral' }) {
  const heights = ['h-1', 'h-2', 'h-3', 'h-4'];
  const fillClass = toneFillClass(tone);

  return (
    <div className="mt-0.5 flex h-4 items-end justify-end gap-0.5" aria-label={`${bars} WiFi signal bars`}>
      {heights.map((height, idx) => {
        const active = idx < bars;
        return <span key={height} className={`w-1 ${height} ${active ? fillClass : 'bg-neutral-700'}`} />;
      })}
    </div>
  );
}
