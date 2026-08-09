// Fullscreen Fleet Energy Report
// Purpose: Shows every rover together in one dense, read-only battery-health and efficiency workspace.
// Scope: Uses existing CardFrame, surface, button, page-theme, and spacing globals; intentionally contains no charts.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import CardFrame from '../components/CardFrame/index.jsx';
import SocketConnectionPill from '../components/SocketConnectionPill/index.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import useUserIdentitySync from '../hooks/useUserIdentitySync.js';
import useFleetReport from '../hooks/useFleetReport.js';
import { isFeatureEnabled } from '../lib/features.js';
import { useSettingsNamespace } from '../settings/index.js';
import { DEFAULT_PAGE_THEME_KEY, themeGapClass, usePageThemeClass } from '../themes/index.js';

const RANGE_OPTIONS = [
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '90 days', ms: 90 * 24 * 60 * 60 * 1000 },
  { label: '1 year', ms: 365 * 24 * 60 * 60 * 1000 },
];

function number(value, digits = 2) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
    : '--';
}

function timestamp(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleString() : '--';
}

function duration(value) {
  const minutes = Math.round((Number(value) || 0) / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function distance(value) {
  const millimeters = Number(value) || 0;
  return millimeters >= 1e6 ? `${number(millimeters / 1e6)} km` : `${number(millimeters / 1000, 1)} m`;
}

function exportCsv(rows) {
  // Papa Parse owns quoting and escaping so new metric columns cannot silently
  // corrupt exports when rover names or confidence explanations contain commas.
  const csv = Papa.unparse(rows.map((rover) => ({
    ...rover,
    batteryHealth: JSON.stringify(rover.batteryHealth),
  })));
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'fleet-battery-efficiency.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function Metric({ label, value, detail }) {
  return (
    <div className="surface min-w-0 px-1 py-0.5">
      <div className="text-[0.68rem] text-slate-400">{label}</div>
      <div className="truncate text-sm font-semibold text-slate-100">{value}</div>
      {detail ? <div className="truncate text-[0.68rem] text-slate-500">{detail}</div> : null}
    </div>
  );
}

function SortHeading({ field, sort, onSort, children }) {
  // Sorting is an explicit table interaction rather than hidden column state;
  // the arrow tells users which fleet comparison currently controls row order.
  return <th><button type="button" className="whitespace-nowrap text-left" onClick={() => onSort(field)}>{children}{sort.key === field ? (sort.descending ? ' ↓' : ' ↑') : ''}</button></th>;
}

function BatteryRegistry({ report, refresh }) {
  const socket = useSocket();
  const role = useSessionSelector((state) => state.session?.role || null);
  const canEdit = role === 'admin' || role === 'lockdown';
  const [draft, setDraft] = useState({
    roverId: report.rovers[0]?.roverId || '',
    chemistry: 'unknown',
    ratedCapacityMah: '',
    installedDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [status, setStatus] = useState('');

  function submit(event) {
    event.preventDefault();
    setStatus('Saving…');
    socket.emit('fleetReports:replaceBattery', {
      ...draft,
      ratedCapacityMah: Number(draft.ratedCapacityMah),
      installedAt: new Date(`${draft.installedDate}T12:00:00`).getTime(),
    }, (response = {}) => {
      setStatus(response.error || `Registered ${response.battery?.batteryKey || 'battery'}`);
      if (!response.error) refresh();
    });
  }

  return (
    <CardFrame title="Battery identity and baselines" meta={`${report.batteryRegistry.length} records`} bodyClassName="space-y-0.5 p-0.5">
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead className="text-slate-400"><tr><th>Rover</th><th>Battery</th><th>Chemistry</th><th>Rated mAh</th><th>Installed</th><th>Retired</th><th>Learned baseline mAh</th><th>Notes</th></tr></thead>
          <tbody>{report.batteryRegistry.map((battery) => (
            <tr key={battery.batteryKey} className="border-t border-neutral-700/70 text-slate-200">
              <td>{battery.roverId}</td><td>{battery.batteryKey}</td><td>{battery.chemistry || '--'}</td>
              <td>{number(battery.ratedCapacityMah, 0)}</td><td>{timestamp(battery.installedAt)}</td>
              <td>{timestamp(battery.retiredAt)}</td><td>{number(battery.healthyBaselineMah, 0)}</td><td>{battery.notes || '--'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {canEdit ? (
        <form className="surface grid gap-0.5 p-1 text-xs md:grid-cols-2 xl:grid-cols-6" onSubmit={submit}>
          <label><span className="text-slate-400">Rover</span><select className="w-full bg-neutral-800 p-0.5" value={draft.roverId} onChange={(event) => setDraft((value) => ({ ...value, roverId: event.target.value }))}>{report.rovers.map((rover) => <option key={rover.roverId} value={rover.roverId}>{rover.name}</option>)}</select></label>
          <label><span className="text-slate-400">Chemistry</span><select className="w-full bg-neutral-800 p-0.5" value={draft.chemistry} onChange={(event) => setDraft((value) => ({ ...value, chemistry: event.target.value }))}><option value="unknown">Unknown</option><option value="NiMH">NiMH</option><option value="Li-ion">Li-ion</option></select></label>
          <label><span className="text-slate-400">Rated capacity mAh</span><input required min="1" max="65535" type="number" className="w-full bg-neutral-800 p-0.5" value={draft.ratedCapacityMah} onChange={(event) => setDraft((value) => ({ ...value, ratedCapacityMah: event.target.value }))} /></label>
          <label><span className="text-slate-400">Installed</span><input required type="date" className="w-full bg-neutral-800 p-0.5" value={draft.installedDate} onChange={(event) => setDraft((value) => ({ ...value, installedDate: event.target.value }))} /></label>
          <label><span className="text-slate-400">Notes</span><input className="w-full bg-neutral-800 p-0.5" value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></label>
          <div className="flex items-end gap-0.5"><button type="submit" className="button-dark px-1 py-0.5">Install or replace</button><span className="text-slate-400">{status}</span></div>
        </form>
      ) : null}
    </CardFrame>
  );
}

function FullReportContent() {
  const [rangeMs, setRangeMs] = useState(RANGE_OPTIONS[1].ms);
  const [rangeEnd, setRangeEnd] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'name', descending: false });
  const { report, loading, error, refresh } = useFleetReport({
    since: rangeEnd - rangeMs,
    until: rangeEnd,
    includeEvents: false,
  });

  const rows = useMemo(() => {
    const filtered = (report?.rovers || []).filter((rover) =>
      `${rover.name} ${rover.roverId}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
    return [...filtered].sort((left, right) => {
      const leftValue = sort.key.startsWith('batteryHealth.')
        ? left.batteryHealth?.[sort.key.slice('batteryHealth.'.length)]
        : left[sort.key];
      const rightValue = sort.key.startsWith('batteryHealth.')
        ? right.batteryHealth?.[sort.key.slice('batteryHealth.'.length)]
        : right[sort.key];
      const result = typeof leftValue === 'string'
        ? leftValue.localeCompare(String(rightValue ?? ''))
        : (Number(leftValue) || 0) - (Number(rightValue) || 0);
      return sort.descending ? -result : result;
    });
  }, [query, report, sort]);

  function sortBy(key) {
    setSort((current) => ({ key, descending: current.key === key ? !current.descending : false }));
  }

  return (
    <>
      <CardFrame title="Fleet battery health and efficiency" meta={report ? timestamp(report.generatedAt) : 'Loading'} bodyClassName="space-y-0.5 p-0.5">
        <div className="surface flex flex-wrap items-end gap-0.5 p-0.5 text-xs">
          <label><span className="mr-0.5 text-slate-400">Range</span><select className="bg-neutral-800 p-0.5" value={rangeMs} onChange={(event) => setRangeMs(Number(event.target.value))}>{RANGE_OPTIONS.map((option) => <option key={option.ms} value={option.ms}>{option.label}</option>)}</select></label>
          <label><span className="mr-0.5 text-slate-400">Find rover</span><input className="bg-neutral-800 p-0.5" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button type="button" className="button-dark px-1 py-0.5" onClick={() => { setRangeEnd(Date.now()); refresh(); }}>Refresh</button>
          <Link className="button-dark px-1 py-0.5" to="/">Back</Link>
        </div>
        {loading && !report ? <p className="text-slate-400">Loading fleet metrics…</p> : null}
        {error ? <p className="text-red-300">{error}</p> : null}
        {report ? (
          <div className="grid grid-cols-2 gap-0.5 md:grid-cols-4 xl:grid-cols-8">
            <Metric label="Rovers online" value={`${report.totals.onlineRoverCount}/${report.totals.roverCount}`} />
            <Metric label="Distance" value={distance(report.totals.distanceMm)} />
            <Metric label="Energy used" value={`${number(report.totals.dischargedWh)} Wh`} />
            <Metric label="Fleet Wh/km" value={report.totals.overallWhPerKm == null ? '--' : number(report.totals.overallWhPerKm)} />
            <Metric label="Moving Wh/km" value={report.totals.movingWhPerKm == null ? '--' : number(report.totals.movingWhPerKm)} />
            <Metric label="Moving energy" value={`${number(report.totals.movingDischargedWh)} Wh`} />
            <Metric label="Stationary energy" value={`${number(report.totals.stationaryDischargedWh)} Wh`} />
            <Metric label="Attention" value={number(report.totals.attentionCount, 0)} />
          </div>
        ) : null}
      </CardFrame>

      {report ? (
        <>
          <CardFrame
            title="All rovers"
            meta={`${rows.length} visible`}
            actions={<button type="button" className="button-dark px-1 py-0.25 text-xs" onClick={() => exportCsv(rows)}>Export CSV</button>}
            bodyClassName="overflow-x-auto p-0.5"
          >
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="sticky top-0 bg-neutral-900 text-slate-400"><tr>
                <SortHeading field="name" sort={sort} onSort={sortBy}>Rover</SortHeading><SortHeading field="online" sort={sort} onSort={sortBy}>State</SortHeading>
                <SortHeading field="batteryHealth.capacityRetentionPercent" sort={sort} onSort={sortBy}>Health</SortHeading><SortHeading field="batteryHealth.measuredUsableMah" sort={sort} onSort={sortBy}>Usable Ah</SortHeading>
                <SortHeading field="batteryHealth.measuredUsableWh" sort={sort} onSort={sortBy}>Usable Wh</SortHeading><SortHeading field="batteryHealth.confidence" sort={sort} onSort={sortBy}>Confidence</SortHeading>
                <SortHeading field="overallWhPerKm" sort={sort} onSort={sortBy}>Wh/km</SortHeading><SortHeading field="movingWhPerKm" sort={sort} onSort={sortBy}>Moving Wh/km</SortHeading>
                <SortHeading field="distanceMm" sort={sort} onSort={sortBy}>Distance</SortHeading><SortHeading field="dischargedWh" sort={sort} onSort={sortBy}>Used Wh</SortHeading>
                <SortHeading field="movingDischargedWh" sort={sort} onSort={sortBy}>Moving Wh</SortHeading><SortHeading field="stationaryDischargedWh" sort={sort} onSort={sortBy}>Stationary Wh</SortHeading>
                <SortHeading field="movingMs" sort={sort} onSort={sortBy}>Moving time</SortHeading><SortHeading field="averageSpeedMmPerSecond" sort={sort} onSort={sortBy}>Average speed</SortHeading>
                <SortHeading field="maximumSpeedMmPerSecond" sort={sort} onSort={sortBy}>Maximum speed</SortHeading><SortHeading field="latestChargeMah" sort={sort} onSort={sortBy}>Charge</SortHeading>
                <SortHeading field="averageVoltageMv" sort={sort} onSort={sortBy}>Voltage</SortHeading><SortHeading field="averageCurrentMa" sort={sort} onSort={sortBy}>Current</SortHeading>
                <SortHeading field="maximumTemperatureC" sort={sort} onSort={sortBy}>Temperature</SortHeading><SortHeading field="lastSampleAt" sort={sort} onSort={sortBy}>Last data</SortHeading>
              </tr></thead>
              <tbody>{rows.map((rover) => {
                const health = rover.batteryHealth;
                return (
                  <tr key={rover.roverId} className="border-t border-neutral-700/70 text-slate-200">
                    <td className="sticky left-0 bg-neutral-900 font-semibold">{rover.name}</td><td>{rover.online ? 'online' : 'offline'}</td>
                    <td>{health.capacityRetentionPercent == null ? '--' : `${number(health.capacityRetentionPercent, 1)}%`}</td>
                    <td>{health.measuredUsableMah == null ? '--' : number(health.measuredUsableMah / 1000, 3)}</td>
                    <td>{number(health.measuredUsableWh)}</td><td title={health.confidenceReason}>{health.confidence}</td>
                    <td>{rover.overallWhPerKm == null ? `need ${distance(rover.efficiencyDistanceRequiredMm)}` : number(rover.overallWhPerKm)}</td>
                    <td>{number(rover.movingWhPerKm)}</td><td>{distance(rover.distanceMm)}</td><td>{number(rover.dischargedWh)}</td>
                    <td>{number(rover.movingDischargedWh)}</td><td>{number(rover.stationaryDischargedWh)}</td><td>{duration(rover.movingMs)}</td>
                    <td>{rover.averageSpeedMmPerSecond == null ? '--' : `${number(rover.averageSpeedMmPerSecond)} mm/s`}</td>
                    <td>{rover.maximumSpeedMmPerSecond == null ? '--' : `${number(rover.maximumSpeedMmPerSecond)} mm/s`}</td>
                    <td>{number(rover.latestChargeMah, 0)} mAh</td><td>{number(rover.averageVoltageMv, 0)} mV</td>
                    <td>{number(rover.averageCurrentMa, 0)} mA</td><td>{number(rover.maximumTemperatureC, 1)} °C</td><td>{timestamp(rover.lastSampleAt)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </CardFrame>

          <CardFrame title="Battery-health evidence" meta="All rovers" bodyClassName="overflow-x-auto p-0.5">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="text-slate-400"><tr><th>Rover</th><th>Battery</th><th>Reference mAh</th><th>Estimated usable mAh</th><th>Observed range floor</th><th>Retention</th><th>Observations</th><th>Average depth</th><th>Throughput</th><th>Latest evidence</th><th>Confidence basis</th></tr></thead>
              <tbody>{rows.map((rover) => {
                const health = rover.batteryHealth;
                return <tr key={rover.roverId} className="border-t border-neutral-700/70 text-slate-200"><td>{rover.name}</td><td>{health.batteryKey}</td><td>{number(health.referenceMah, 0)}</td><td>{number(health.measuredUsableMah, 0)}</td><td>{number(health.observedUsableFloorMah, 0)}</td><td>{health.capacityRetentionPercent == null ? '--' : `${number(health.capacityRetentionPercent, 1)}%`}</td><td>{number(health.observationCount, 0)}</td><td>{number(health.averageObservationDepthPercent, 1)}%</td><td>{number(health.dischargedThroughputMah, 0)} mAh</td><td>{timestamp(health.latestObservationAt)}</td><td>{health.confidenceReason}</td></tr>;
              })}</tbody>
            </table>
          </CardFrame>

          {report.attention.length ? (
            <CardFrame title="Attention" meta={report.attention.length} bodyClassName="p-0.5 text-xs">
              <table className="w-full text-left"><thead className="text-slate-400"><tr><th>Rover</th><th>Severity</th><th>Reason</th></tr></thead><tbody>{report.attention.map((item) => <tr key={item.key} className="border-t border-neutral-700/70"><td>{item.roverId}</td><td>{item.severity}</td><td>{item.title}</td></tr>)}</tbody></table>
            </CardFrame>
          ) : null}

          <BatteryRegistry report={report} refresh={refresh} />

          <CardFrame title="Methodology" bodyClassName="space-y-0.5 p-1 text-xs text-slate-300">
            <p>Energy is integrated per sensor interval from OI voltage and signed current. Existing odometer distance and speed are consumed directly; reporting does not calculate a competing speed value.</p>
            <p>Capacity combines partial discharge current with packet 25 charge movement. Every usable observation contributes; deeper observations increase confidence without labeling cycles good or bad. Packet 26 is only a fixed reference.</p>
            <p>Wh/km appears after 25 m of selected-range odometer travel. Existing historical rows predate exact power integration, so their Wh fields remain zero rather than being backfilled with false precision.</p>
          </CardFrame>
        </>
      ) : null}
    </>
  );
}

export default function FleetReportsApp() {
  useUserIdentitySync({ identitySurface: 'passive' });
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'fleetReports'));
  const { value: pageSettings } = useSettingsNamespace('page', { backgroundTheme: DEFAULT_PAGE_THEME_KEY });
  const pageBackgroundClass = usePageThemeClass(pageSettings?.backgroundTheme);
  return (
    <div className={`${pageBackgroundClass} min-h-screen text-slate-100`}>
      <SocketConnectionPill />
      <main className={`mx-auto flex min-h-screen w-full max-w-[120rem] flex-col ${themeGapClass} p-1`}>
        {enabled ? <FullReportContent /> : (
          <CardFrame title="Fleet reports unavailable" bodyClassName="space-y-0.5 p-1 text-sm text-slate-300">
            <p>This server has not enabled fleet reporting.</p>
            <Link className="button-dark inline-block px-1 py-0.5 text-xs" to="/">Back to rover page</Link>
          </CardFrame>
        )}
      </main>
    </div>
  );
}
