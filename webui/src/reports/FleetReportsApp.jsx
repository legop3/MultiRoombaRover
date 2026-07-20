// Fullscreen Fleet Reports Application
// Purpose: Presents deep read-only operational history using the same global cards, surfaces, theme, and spacing as the driver page.
// Scope: Owns report-range controls, dense evidence tables, chart selection, CSV export, and route-level feature handling.
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
import { DEFAULT_PAGE_THEME_KEY, getPageThemeClass, themeGapClass } from '../themes/index.js';
import FleetTimeSeriesChart from './FleetTimeSeriesChart.jsx';

const RANGE_OPTIONS = [
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '90 days', ms: 90 * 24 * 60 * 60 * 1000 },
  { label: '1 year', ms: 365 * 24 * 60 * 60 * 1000 },
];

const METRICS = [
  ['dischargedMah', 'Discharged mAh'],
  ['chargedMah', 'Charged mAh'],
  ['avgVoltageMv', 'Average voltage'],
  ['avgCurrentMa', 'Average current'],
  ['avgTemperatureC', 'Average temperature'],
];

function number(value, digits = 2) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
    : '--';
}

function timestamp(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? new Date(Number(value)).toLocaleString()
    : '--';
}

function duration(value) {
  const minutes = Math.round((Number(value) || 0) / 60000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

function distance(value) {
  const mm = Number(value) || 0;
  return mm >= 1000000 ? `${number(mm / 1000000)} km` : `${number(mm / 1000)} m`;
}

function Metric({ label, value, detail = null }) {
  return (
    <div className="surface min-w-0 px-1 py-0.5">
      <div className="text-[0.68rem] text-slate-400">{label}</div>
      <div className="truncate text-sm font-semibold text-slate-100">{value}</div>
      {detail ? <div className="truncate text-[0.68rem] text-slate-500">{detail}</div> : null}
    </div>
  );
}

function exportCsv(name, rows) {
  // Papa Parse owns CSV quoting and nested-value escaping. JSON-stringifying
  // object cells preserves evidence without maintaining a fragile custom CSV
  // serializer for arbitrary structured event payloads.
  const normalized = rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value && typeof value === 'object' ? JSON.stringify(value) : value]),
  ));
  const csv = Papa.unparse(normalized);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function BatteryRegistryPanel({ report, onSaved }) {
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

  const submit = (event) => {
    event.preventDefault();
    setStatus('Saving…');
    socket.emit('fleetReports:replaceBattery', {
      roverId: draft.roverId,
      chemistry: draft.chemistry,
      ratedCapacityMah: Number(draft.ratedCapacityMah),
      installedAt: new Date(`${draft.installedDate}T12:00:00`).getTime(),
      notes: draft.notes,
    }, (response = {}) => {
      if (response.error) {
        setStatus(response.error);
        return;
      }
      setStatus(`Registered ${response.battery?.batteryKey || 'battery'}`);
      onSaved();
    });
  };

  return (
    <CardFrame title="Physical battery registry" meta={`${report.batteryRegistry.length} historical records`} bodyClassName="space-y-0.5 p-0.5">
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead className="text-slate-400"><tr><th>Rover</th><th>Battery identity</th><th>Chemistry</th><th>Rated capacity mAh</th><th>Installed</th><th>Retired</th><th>Learned baseline mAh</th><th>Notes</th></tr></thead>
          <tbody>{report.batteryRegistry.map((battery) => (
            <tr key={battery.batteryKey} className="border-t border-neutral-700/70 text-slate-200">
              <td>{battery.roverId}</td><td>{battery.batteryKey}</td><td>{battery.chemistry || '--'}</td><td>{number(battery.ratedCapacityMah, 0)}</td>
              <td>{timestamp(battery.installedAt)}</td><td>{timestamp(battery.retiredAt)}</td><td>{number(battery.healthyBaselineMah)}</td><td>{battery.notes || '--'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {canEdit ? (
        <form className="surface grid gap-0.5 p-1 text-xs md:grid-cols-2 xl:grid-cols-6" onSubmit={submit}>
          <label className="space-y-0.5"><span className="text-slate-400">Rover</span><select className="w-full bg-neutral-800 p-0.5" value={draft.roverId} onChange={(event) => setDraft((current) => ({ ...current, roverId: event.target.value }))}>{report.rovers.map((rover) => <option key={rover.roverId} value={rover.roverId}>{rover.name}</option>)}</select></label>
          <label className="space-y-0.5"><span className="text-slate-400">Chemistry</span><select className="w-full bg-neutral-800 p-0.5" value={draft.chemistry} onChange={(event) => setDraft((current) => ({ ...current, chemistry: event.target.value }))}><option value="unknown">Unknown</option><option value="NiMH">NiMH</option><option value="Li-ion">Li-ion</option></select></label>
          <label className="space-y-0.5"><span className="text-slate-400">Rated capacity mAh</span><input required min="1" max="65535" type="number" className="w-full bg-neutral-800 p-0.5" value={draft.ratedCapacityMah} onChange={(event) => setDraft((current) => ({ ...current, ratedCapacityMah: event.target.value }))} /></label>
          <label className="space-y-0.5"><span className="text-slate-400">Installation date</span><input required type="date" className="w-full bg-neutral-800 p-0.5" value={draft.installedDate} onChange={(event) => setDraft((current) => ({ ...current, installedDate: event.target.value }))} /></label>
          <label className="space-y-0.5"><span className="text-slate-400">Notes</span><input className="w-full bg-neutral-800 p-0.5" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          <div className="flex items-end gap-0.5"><button type="submit" className="button-dark px-1 py-0.5">Install/replace battery</button><span className="text-slate-400">{status}</span></div>
        </form>
      ) : <p className="surface px-1 py-0.5 text-xs text-slate-400">Battery history is read-only. Admin access is required to register a physical replacement.</p>}
    </CardFrame>
  );
}

function FullReportContent() {
  const [rangeMs, setRangeMs] = useState(RANGE_OPTIONS[1].ms);
  const [rangeEnd, setRangeEnd] = useState(() => Date.now());
  const [metric, setMetric] = useState('dischargedMah');
  const [selectedRovers, setSelectedRovers] = useState([]);
  const since = rangeEnd - rangeMs;
  const { report, loading, error, refresh } = useFleetReport({
    since,
    until: rangeEnd,
    compact: false,
    includeEvents: true,
    roverIds: selectedRovers.length ? selectedRovers : null,
  });

  const chartRoverIds = useMemo(() => report?.rovers.map((rover) => rover.roverId) || [], [report]);
  const toggleRover = (roverId) => {
    setSelectedRovers((current) => current.includes(roverId)
      ? current.filter((id) => id !== roverId)
      : [...current, roverId]);
  };

  return (
    <>
      <CardFrame
        title="Fleet reports"
        meta={report ? `Generated ${timestamp(report.generatedAt)}` : 'Read-only operational history'}
        actions={<Link className="button-dark px-1 py-0.25 text-[0.75rem]" to="/">Back to rover page</Link>}
        bodyClassName="space-y-0.5 p-0.5 text-sm"
      >
        <div className="flex flex-wrap items-center gap-0.5">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className={`button-dark px-1 py-0.5 text-xs ${rangeMs === option.ms ? 'text-cyan-200' : ''}`}
              onClick={() => { setRangeMs(option.ms); setRangeEnd(Date.now()); }}
            >
              {option.label}
            </button>
          ))}
          <button type="button" className="button-dark px-1 py-0.5 text-xs" onClick={() => setRangeEnd(Date.now())}>Refresh</button>
          <span className="text-xs text-slate-400">{timestamp(since)} through {timestamp(rangeEnd)}</span>
        </div>
        {report?.rovers.length ? (
          <div className="flex flex-wrap gap-0.5">
            {report.rovers.map((rover) => (
              <button
                key={rover.roverId}
                type="button"
                className={`button-dark px-1 py-0.5 text-xs ${selectedRovers.includes(rover.roverId) ? 'text-cyan-200' : ''}`}
                onClick={() => toggleRover(rover.roverId)}
              >
                {selectedRovers.includes(rover.roverId) ? '✓ ' : ''}{rover.name}
              </button>
            ))}
            {selectedRovers.length ? <button type="button" className="button-dark px-1 py-0.5 text-xs" onClick={() => setSelectedRovers([])}>Clear rover filter</button> : null}
          </div>
        ) : null}
      </CardFrame>

      {loading && !report ? <CardFrame title="Loading" bodyClassName="p-1 text-sm text-slate-400">Loading detailed fleet evidence…</CardFrame> : null}
      {error ? <CardFrame title="Report unavailable" bodyClassName="p-1 text-sm text-red-300">{error}</CardFrame> : null}

      {report ? (
        <>
          <CardFrame title="Exact totals" meta={`${report.totals.sampleCount.toLocaleString()} sensor samples`} bodyClassName="grid grid-cols-2 gap-0.5 p-0.5 md:grid-cols-4 xl:grid-cols-6">
            <Metric label="Rovers" value={`${report.totals.onlineRoverCount}/${report.totals.roverCount} online`} />
            <Metric label="Telemetry coverage" value={duration(report.totals.coverageMs)} />
            <Metric label="Telemetry gaps" value={number(report.totals.telemetryGapCount, 0)} />
            <Metric label="Commands" value={number(report.totals.commandCount, 0)} detail={`${number(report.totals.driveCommandCount, 0)} drive/motor`} />
            <Metric label="Rejected commands" value={number(report.totals.rejectedCommandCount, 0)} />
            <Metric label="Distance" value={distance(report.totals.distanceMm)} />
            <Metric label="Overcurrent episodes" value={number(report.totals.overcurrentEpisodeCount, 0)} />
            <Metric label="Bumps" value={number(report.totals.bumpCount, 0)} />
            <Metric label="Cliff episodes" value={number(report.totals.cliffCount, 0)} />
            <Metric label="Wheel drops" value={number(report.totals.wheelDropCount, 0)} />
            <Metric label="Virtual walls" value={number(report.totals.virtualWallCount, 0)} />
            <Metric label="Charged" value={`${number(report.totals.chargedMah)} mAh`} />
            <Metric label="Discharged" value={`${number(report.totals.dischargedMah)} mAh`} />
            <Metric label="Battery sessions" value={number(report.totals.batterySessionCount, 0)} />
            <Metric label="Warnings" value={number(report.totals.warningFindingCount, 0)} />
            <Metric label="Critical" value={number(report.totals.criticalFindingCount, 0)} />
          </CardFrame>

          <CardFrame title="Needs attention" meta={report.findings.length} bodyClassName="space-y-0.5 p-0.5 text-xs">
            {report.findings.length ? report.findings.map((finding) => (
              <details key={finding.key} className="surface px-1 py-0.5">
                <summary className="cursor-pointer text-slate-100">
                  <span className={finding.severity === 'critical' ? 'text-red-300' : finding.severity === 'warning' ? 'text-amber-300' : 'text-slate-400'}>{finding.severity}</span>
                  {' · '}{finding.roverId ? `${finding.roverId} · ` : ''}{finding.title} · confidence {finding.confidence}
                </summary>
                <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-[0.68rem] text-slate-300">{JSON.stringify(finding.evidence, null, 2)}</pre>
              </details>
            )) : <p className="surface px-1 py-0.5 text-emerald-300">No findings in the selected range.</p>}
          </CardFrame>

          <CardFrame
            title="Time series"
            meta={`${report.minutes.length.toLocaleString()} minute rows`}
            actions={(
              <select className="surface px-1 py-0.25 text-xs text-slate-100" value={metric} onChange={(event) => setMetric(event.target.value)}>
                {METRICS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            )}
            bodyClassName="p-0.5"
          >
            <FleetTimeSeriesChart minutes={report.minutes} roverIds={chartRoverIds} metric={metric} />
          </CardFrame>

          <CardFrame
            title="Rover comparison"
            meta={report.rovers.length}
            actions={<button type="button" className="button-dark px-1 py-0.25 text-xs" onClick={() => exportCsv('fleet-rovers.csv', report.rovers)}>Export CSV</button>}
            bodyClassName="overflow-x-auto p-0.5"
          >
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="text-slate-400"><tr><th>Rover</th><th>Online</th><th>Samples</th><th>Coverage</th><th>Gaps</th><th>Distance</th><th>Commands</th><th>Drive/motor</th><th>Rejected</th><th>Overcurrents</th><th>Bumps</th><th>Cliffs</th><th>Wheel drops</th><th>Virtual walls</th><th>Charged mAh</th><th>Discharged mAh</th><th>Voltage avg/min/max mV</th><th>Temperature avg/min/max °C</th><th>Charge now mAh</th><th>Reported capacity mAh</th><th>Last sample</th></tr></thead>
              <tbody>{report.rovers.map((rover) => (
                <tr key={rover.roverId} className="border-t border-neutral-700/70 text-slate-200">
                  <td>{rover.name}</td><td>{rover.online ? 'yes' : 'no'}</td><td>{number(rover.sampleCount, 0)}</td><td>{duration(rover.coverageMs)}</td><td>{number(rover.gapCount, 0)}</td><td>{distance(rover.distanceMm)}</td><td>{number(rover.commandCount, 0)}</td><td>{number(rover.driveCommandCount, 0)}</td><td>{number(rover.rejectedCommandCount, 0)}</td><td>{number(rover.overcurrentEpisodeCount, 0)}</td><td>{number(rover.bumpCount, 0)}</td><td>{number(rover.cliffCount, 0)}</td><td>{number(rover.wheelDropCount, 0)}</td><td>{number(rover.virtualWallCount, 0)}</td>
                  <td>{number(rover.chargedMah)}</td><td>{number(rover.dischargedMah)}</td>
                  <td>{number(rover.averageVoltageMv, 0)} / {number(rover.minimumVoltageMv, 0)} / {number(rover.maximumVoltageMv, 0)}</td>
                  <td>{number(rover.averageTemperatureC)} / {number(rover.minimumTemperatureC)} / {number(rover.maximumTemperatureC)}</td>
                  <td>{number(rover.latestChargeMah, 0)}</td><td>{number(rover.reportedCapacityMah, 0)}</td><td>{timestamp(rover.lastSampleAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardFrame>

          <CardFrame
            title="Battery sessions"
            meta={report.batterySessions.length}
            actions={<button type="button" className="button-dark px-1 py-0.25 text-xs" onClick={() => exportCsv('fleet-battery-sessions.csv', report.batterySessions)}>Export CSV</button>}
            bodyClassName="overflow-x-auto p-0.5"
          >
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="text-slate-400"><tr><th>Rover</th><th>Kind</th><th>Started</th><th>Ended</th><th>Duration</th><th>Start/end charge</th><th>Charged mAh</th><th>Discharged mAh</th><th>Voltage min/max</th><th>Temperature min/max</th><th>Samples</th><th>Gaps</th><th>Confidence</th><th>Qualification</th></tr></thead>
              <tbody>{report.batterySessions.map((session) => (
                <tr key={session.id} className="border-t border-neutral-700/70 text-slate-200">
                  <td>{session.roverId}</td><td>{session.kind}</td><td>{timestamp(session.startedAt)}</td><td>{timestamp(session.endedAt)}</td><td>{duration((session.endedAt || report.generatedAt) - session.startedAt)}</td>
                  <td>{number(session.startChargeMah, 0)} / {number(session.endChargeMah, 0)} mAh</td><td>{number(session.chargedMah)}</td><td>{number(session.dischargedMah)}</td>
                  <td>{number(session.minVoltageMv, 0)} / {number(session.maxVoltageMv, 0)} mV</td><td>{number(session.minTemperatureC)} / {number(session.maxTemperatureC)} °C</td>
                  <td>{number(session.sampleCount, 0)}</td><td>{number(session.gapCount, 0)}</td><td>{session.confidence}</td><td>{session.qualificationReason}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardFrame>

          <CardFrame title="Battery health calculations" meta={report.batteryHealth.length} bodyClassName="overflow-x-auto p-0.5">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="text-slate-400"><tr><th>Rover</th><th>Battery identity</th><th>Qualified tests</th><th>Baseline tests</th><th>Learned baseline mAh</th><th>Latest usable mAh</th><th>Capacity retained</th><th>Discharged throughput mAh</th><th>Equivalent full cycles</th><th>Latest qualified test</th><th>Confidence</th><th>Confidence reason</th></tr></thead>
              <tbody>{report.batteryHealth.map((health) => (
                <tr key={health.roverId} className="border-t border-neutral-700/70 text-slate-200">
                  <td>{health.roverId}</td><td>{health.batteryKey}</td><td>{number(health.qualifiedTestCount, 0)}</td><td>{number(health.baselineTestCount, 0)}</td>
                  <td>{number(health.baselineMah)}</td><td>{number(health.measuredUsableMah)}</td><td>{health.capacityRetentionPercent == null ? '--' : `${number(health.capacityRetentionPercent)}%`}</td>
                  <td>{number(health.dischargedThroughputMah)}</td><td>{number(health.equivalentFullCycles, 3)}</td><td>{timestamp(health.latestQualifiedTestAt)}</td><td>{health.confidence}</td><td>{health.confidenceReason}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardFrame>

          <BatteryRegistryPanel report={report} onSaved={refresh} />

          <CardFrame
            title="Structured event history"
            meta={`${report.events.length} returned`}
            actions={<button type="button" className="button-dark px-1 py-0.25 text-xs" onClick={() => exportCsv('fleet-events.csv', report.events)}>Export CSV</button>}
            bodyClassName="space-y-0.5 p-0.5"
          >
            {report.events.map((event) => (
              <details key={event.id} className="surface px-1 py-0.5 text-xs">
                <summary className="cursor-pointer text-slate-200">{timestamp(event.ts)} · {event.severity} · {event.source} · {event.type}{event.roverId ? ` · ${event.roverId}` : ''}</summary>
                <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-[0.68rem] text-slate-300">{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            ))}
          </CardFrame>

          <CardFrame title="Daily report and Discord delivery history" meta={report.dailyReportHistory.length} bodyClassName="overflow-x-auto p-0.5">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="text-slate-400"><tr><th>Report day</th><th>Generated</th><th>Stored bytes</th><th>Discord delivered</th><th>Delivery error</th></tr></thead>
              <tbody>{report.dailyReportHistory.map((daily) => (
                <tr key={daily.reportDate} className="border-t border-neutral-700/70 text-slate-200">
                  <td>{daily.reportDate}</td><td>{timestamp(daily.generatedAt)}</td><td>{number(daily.reportBytes, 0)}</td><td>{timestamp(daily.discordDeliveredAt)}</td><td>{daily.discordError || '--'}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardFrame>

          <CardFrame title="Collector and storage diagnostics" bodyClassName="grid gap-0.5 p-0.5 md:grid-cols-2">
            <pre className="surface overflow-x-auto whitespace-pre-wrap p-1 text-[0.68rem] text-slate-300">{JSON.stringify(report.diagnostics.collector, null, 2)}</pre>
            <pre className="surface overflow-x-auto whitespace-pre-wrap p-1 text-[0.68rem] text-slate-300">{JSON.stringify(report.diagnostics.storage, null, 2)}</pre>
          </CardFrame>

          <CardFrame title="Methodology" bodyClassName="space-y-0.5 p-1 text-xs text-slate-300">
            <p>Battery throughput integrates OI packet 23 signed battery current: delta mAh = current mA × elapsed milliseconds / 3,600,000. Positive current is charged throughput; negative current is discharged throughput.</p>
            <p>Intervals exceeding the configured maximum gap are excluded rather than interpreted as zero. Packet 25 charge movement is retained as independent evidence. Packet 26 is displayed as the rover-reported fixed reference and is not treated as measured battery health.</p>
            <p>A high-confidence capacity test requires a qualified full endpoint, continuous telemetry, configured minimum discharge depth, and a low endpoint. Partial or interrupted sessions remain visible with lower confidence and an explicit qualification reason.</p>
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
  const pageBackgroundClass = getPageThemeClass(pageSettings?.backgroundTheme);
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
