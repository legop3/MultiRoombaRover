// Odometer Panel
// Purpose: Renders persistent rover distance totals derived from Roomba wheel encoders.
// Scope: Keeps odometer display and socket subscription logic isolated from the raw sensor panel.
import { useEffect, useMemo, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
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

function formatCount(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : '--';
}

function formatAge(timestamp, now) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return '--';
  const ageMs = Math.max(0, now - value);
  if (ageMs < 1500) return 'now';
  if (ageMs < 60 * 1000) return `${Math.round(ageMs / 1000)}s ago`;
  return `${Math.round(ageMs / (60 * 1000))}m ago`;
}

function roverLabel(rover) {
  return rover?.name || rover?.id || 'Unknown rover';
}

export default function OdometerPanel() {
  const socket = useSocket();
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const sessionOdometers = useSessionSelector((state) => state.session?.odometers ?? []);
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

  const primaryRoverId = assignedRoverId || visibleRows[0]?.rover?.id || null;
  const primaryRover = visibleRows.find((entry) => String(entry.rover?.id) === String(primaryRoverId))?.rover || null;
  const primary = primaryRoverId ? odometerMap[String(primaryRoverId)] || null : null;

  return (
    <CardFrame title="Rover odometer" clipOverflow={false} bodyClassName="space-y-0.5 text-base text-slate-100">
      {!primaryRoverId ? (
        <p className="text-sm text-slate-500">No rover odometer data yet.</p>
      ) : (
        <>
          <OdometerSummary odometer={primary} rover={primaryRover} now={now} />
          <div className="grid gap-0.5 md:grid-cols-2">
            <EncoderDetails odometer={primary} />
            <CalibrationDetails odometer={primary} now={now} />
          </div>
          <RoverOdometerList rows={visibleRows} primaryRoverId={primaryRoverId} />
        </>
      )}
    </CardFrame>
  );
}

function OdometerSummary({ odometer, rover, now }) {
  const status = odometer?.status || 'waiting';
  const statusReason = odometer?.statusReason || 'waiting for encoder sample';
  return (
    <div className="space-y-0.5">
      <div className="text-sm font-semibold text-slate-200">{roverLabel(rover)}</div>
      <div className="grid grid-cols-2 gap-0.5 md:grid-cols-3">
        <Metric label="Total distance" value={formatDistance(odometer?.totalMm)} />
        <Metric label="Session distance" value={formatDistance(odometer?.sessionMm)} />
        <Metric label="Last update" value={formatAge(odometer?.updatedAt, now)} />
        <Metric label="Status" value={status} />
        <Metric label="Reason" value={statusReason} />
        <Metric label="Calibration" value={`${Number(odometer?.calibrationMultiplier || 1).toFixed(3)}x`} />
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

function EncoderDetails({ odometer }) {
  const delta = odometer?.lastDelta || null;
  return (
    <DetailCard title="Wheel encoders">
      <ValueRow label="Left count" value={formatCount(odometer?.lastLeftCount)} />
      <ValueRow label="Right count" value={formatCount(odometer?.lastRightCount)} />
      <ValueRow label="Left delta" value={formatCount(delta?.leftCounts)} />
      <ValueRow label="Right delta" value={formatCount(delta?.rightCounts)} />
      <ValueRow label="Center delta" value={formatDistance(delta?.distanceMm)} />
      <ValueRow label="Rollover events" value={formatCount(odometer?.rolloverEvents)} />
      <ValueRow label="Ignored samples" value={formatCount(odometer?.ignoredSamples)} />
    </DetailCard>
  );
}

function CalibrationDetails({ odometer, now }) {
  return (
    <DetailCard title="Conversion">
      <ValueRow label="Source" value="wheel encoders" />
      <ValueRow label="Wheel diameter" value={`${formatCount(odometer?.wheelDiameterMm)} mm`} />
      <ValueRow label="Counts per rev" value={formatCount(odometer?.countsPerRevolution)} />
      <ValueRow label="Base mm per count" value={Number(odometer?.rawMmPerCount || 0).toFixed(4)} />
      <ValueRow label="Active mm per count" value={Number(odometer?.mmPerCount || 0).toFixed(4)} />
      <ValueRow label="Last sample" value={formatAge(odometer?.lastSampleAt, now)} />
    </DetailCard>
  );
}

function RoverOdometerList({ rows, primaryRoverId }) {
  if (!rows.length) return null;
  return (
    <DetailCard title="All rovers">
      {rows.map(({ rover, odometer }) => {
        const active = String(rover?.id) === String(primaryRoverId);
        return (
          <div
            key={rover?.id}
            className={`flex items-center justify-between gap-1 rounded px-1 py-0.5 ${
              active ? 'bg-slate-700/70 text-slate-50' : 'text-slate-200'
            }`}
          >
            <span className="min-w-0 truncate">{roverLabel(rover)}</span>
            <span className="shrink-0 text-right text-slate-100">{formatDistance(odometer?.totalMm)}</span>
            <span className="shrink-0 text-right text-slate-400">{odometer?.status || 'waiting'}</span>
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

function ValueRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-0.5">
      <span className="text-slate-300">{label}</span>
      <span className="min-w-0 truncate text-right text-slate-100">{value ?? '--'}</span>
    </div>
  );
}
