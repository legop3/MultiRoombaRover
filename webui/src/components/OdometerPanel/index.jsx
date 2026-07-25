// Odometer Panel
// Purpose: Renders persistent rover distance totals derived from Roomba wheel encoders.
// Scope: Keeps odometer display and socket subscription logic isolated from the raw sensor panel.
import { useEffect, useMemo, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import useFleetReport from '../../hooks/useFleetReport.js';
import { isFeatureEnabled } from '../../lib/features.js';
import CardFrame from '../CardFrame/index.jsx';

function mapByRoverId(entries = []) {
  const next = {};
  entries.forEach((entry) => {
    if (!entry?.roverId) return;
    next[String(entry.roverId)] = entry;
  });
  return next;
}

function mergeOdometerMap(previous, entries = []) {
  const next = { ...previous };
  entries.forEach((entry) => {
    if (!entry?.roverId) return;
    next[String(entry.roverId)] = entry;
  });
  return next;
}

function formatDistance(mm) {
  const value = Number(mm);
  if (!Number.isFinite(value)) return '--';
  if (value >= 1000 * 1000) return `${(value / (1000 * 1000)).toFixed(2)} km`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} m`;
  return `${Math.round(value)} mm`;
}

function formatAge(timestamp, now) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return '--';
  const ageMs = Math.max(0, now - value);
  if (ageMs < 1500) return 'now';
  if (ageMs < 60 * 1000) return `${Math.round(ageMs / 1000)}s ago`;
  return `${Math.round(ageMs / (60 * 1000))}m ago`;
}

function formatSpeed(mmPerSecond) {
  const value = Number(mmPerSecond);
  if (!Number.isFinite(value)) return '--';
  return `${(value / 1000).toFixed(2)} m/s`;
}

function formatHealth(percent) {
  const value = Number(percent);
  return Number.isFinite(value) ? `${value.toFixed(0)}%` : '--';
}

function formatEfficiency(whPerKm) {
  const value = Number(whPerKm);
  return Number.isFinite(value) ? `${value.toFixed(1)} Wh/km` : '--';
}

function roverLabel(rover) {
  return rover?.name || rover?.id || 'Unknown rover';
}

export default function OdometerPanel() {
  const socket = useSocket();
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const sessionOdometers = useSessionSelector((state) => state.session?.odometers ?? []);
  const fleetReportsEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'fleetReports'));
  const sessionOdometerMap = useMemo(() => mapByRoverId(sessionOdometers), [sessionOdometers]);
  const [liveOdometerMap, setLiveOdometerMap] = useState({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    function handleUpdate({ roverId, odometer } = {}) {
      if (!roverId || !odometer) return;
      setLiveOdometerMap((previous) => ({
        ...previous,
        [String(roverId)]: odometer,
      }));
    }

    socket.on('odometer:update', handleUpdate);
    socket.emit('odometer:subscribe', {}, (response = {}) => {
      if (Array.isArray(response.odometers)) {
        setLiveOdometerMap((previous) => mergeOdometerMap(previous, response.odometers));
      }
    });
    return () => {
      socket.off('odometer:update', handleUpdate);
    };
  }, [socket]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const odometerMap = useMemo(
    () => ({
      ...sessionOdometerMap,
      ...liveOdometerMap,
    }),
    [liveOdometerMap, sessionOdometerMap],
  );

  const visibleRows = useMemo(
    () =>
      roster.map((rover) => ({
        rover,
        odometer: odometerMap[String(rover.id)] || null,
      })),
    [odometerMap, roster],
  );
  const visibleRoverIds = useMemo(() => roster.map((rover) => String(rover.id)), [roster]);

  /*
    The emphasized summary represents "your rover", so it must follow the
    actual assignment rather than silently promoting the first visible rover.
    Unassigned users still retain the compact all-rover list below.
  */
  const primaryRoverId = assignedRoverId || null;
  const primaryRover = visibleRows.find((entry) => String(entry.rover?.id) === String(primaryRoverId))?.rover || null;
  const primary = primaryRoverId ? odometerMap[String(primaryRoverId)] || null : null;

  return (
    <CardFrame title="Rover odometer" clipOverflow={false} bodyClassName="space-y-0.5 text-base text-slate-100">
      {fleetReportsEnabled ? (
        <OdometerReportContent
          now={now}
          primary={primary}
          primaryRover={primaryRover}
          primaryRoverId={primaryRoverId}
          roverIds={visibleRoverIds}
          rows={visibleRows}
        />
      ) : (
        <OdometerContent
          now={now}
          primary={primary}
          primaryRover={primaryRover}
          primaryRoverId={primaryRoverId}
          rows={visibleRows}
        />
      )}
    </CardFrame>
  );
}

function OdometerReportContent({ roverIds, ...props }) {
  // A lazy state initializer establishes one stable 24-hour query boundary;
  // ordinary odometer re-renders must not trigger fresh historical requests.
  const [rangeEnd] = useState(() => Date.now());
  const { report } = useFleetReport({
    since: rangeEnd - 24 * 60 * 60 * 1000,
    until: rangeEnd,
    compact: true,
    includeEvents: false,
    roverIds,
  });
  const reportByRoverId = useMemo(
    () => Object.fromEntries((report?.rovers || []).map((rover) => [String(rover.roverId), rover])),
    [report],
  );
  return <OdometerContent {...props} reportByRoverId={reportByRoverId} />;
}

function OdometerContent({ now, primary, primaryRover, primaryRoverId, rows, reportByRoverId = {} }) {
  const primaryReport = primaryRoverId ? reportByRoverId[String(primaryRoverId)] : null;
  return (
    <>
      {primaryRoverId ? (
        <OdometerSummary odometer={primary} rover={primaryRover} report={primaryReport} now={now} />
      ) : (
        <p className="surface px-1 py-0.5 text-sm text-slate-500">You do not currently have a rover.</p>
      )}
      <RoverOdometerList rows={rows} primaryRoverId={primaryRoverId} reportByRoverId={reportByRoverId} />
    </>
  );
}

function OdometerSummary({ odometer, rover, report, now }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-1 text-sm">
        <span className="font-semibold text-slate-200">{roverLabel(rover)}</span>
        <span className="text-xs text-slate-500">{formatAge(odometer?.updatedAt, now)}</span>
      </div>
      <div className="grid grid-cols-2 gap-0.5 md:grid-cols-5">
        <Metric label="Total distance" value={formatDistance(odometer?.totalMm)} />
        <Metric label="Session distance" value={formatDistance(odometer?.sessionMm)} />
        <Metric label="Current speed" value={formatSpeed(odometer?.wheelSpeedsMmPerSecond?.center)} />
        <Metric label="Battery health" value={formatHealth(report?.batteryHealth?.capacityRetentionPercent)} />
        <Metric label="Efficiency" value={formatEfficiency(report?.overallWhPerKm)} />
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="surface flex items-center justify-between gap-0.5 px-1 py-0.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="min-w-0 truncate text-right text-slate-100">{value ?? '--'}</span>
    </div>
  );
}

function RoverOdometerList({ rows, primaryRoverId, reportByRoverId }) {
  if (!rows.length) return null;
  return (
    <DetailCard title="All rovers">
      {rows.map(({ rover, odometer }) => {
        const active = String(rover?.id) === String(primaryRoverId);
        const report = reportByRoverId[String(rover?.id)];
        return (
          <div
            key={rover?.id}
            className={`flex items-center justify-between gap-1 rounded px-1 py-0.5 ${
              active ? 'bg-slate-700/70 text-slate-50' : 'text-slate-200'
            }`}
          >
            <span className="min-w-0 truncate">{roverLabel(rover)}</span>
            <span className="shrink-0 text-right text-slate-100">{formatDistance(odometer?.totalMm)}</span>
            <span className="shrink-0 text-right text-slate-300">{formatHealth(report?.batteryHealth?.capacityRetentionPercent)}</span>
            <span className="shrink-0 text-right text-slate-400">{formatEfficiency(report?.overallWhPerKm)}</span>
          </div>
        );
      })}
    </DetailCard>
  );
}

function DetailCard({ title, children }) {
  return (
    <div className="surface space-y-0.5 p-1 text-sm">
      <div className="text-[0.78rem] font-semibold leading-none text-slate-200">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
