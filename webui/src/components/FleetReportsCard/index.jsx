// Fleet Reports Card
// Purpose: Shows a dense current fleet summary at the bottom of the Activities tab.
// Scope: Self-gates from session.features and links to the dedicated read-only fullscreen report.
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import useFleetReport from '../../hooks/useFleetReport.js';
import CardFrame from '../CardFrame/index.jsx';

function formatMah(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} mAh` : '--';
}

function formatDuration(ms) {
  const minutes = Math.round((Number(ms) || 0) / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDistance(mm) {
  const value = Number(mm) || 0;
  return value >= 1000000 ? `${(value / 1000000).toFixed(2)} km` : `${(value / 1000).toFixed(1)} m`;
}

function Metric({ label, value }) {
  return (
    <div className="surface flex min-w-0 items-center justify-between gap-1 px-1 py-0.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="truncate text-right font-medium text-slate-100">{value}</span>
    </div>
  );
}

function EnabledFleetReportsCard() {
  // State gives each request a stable range endpoint while allowing the user
  // to advance the 24-hour window explicitly without calling time APIs during
  // render.
  const [now, setNow] = useState(() => Date.now());
  const { report, loading, error } = useFleetReport({
    since: now - 24 * 60 * 60 * 1000,
    until: now,
    compact: true,
    includeEvents: false,
  });

  const actions = (
    <div className="flex items-center gap-0.5">
      <button type="button" className="button-dark px-1 py-0.25 text-[0.75rem]" onClick={() => setNow(Date.now())}>Refresh</button>
      <Link className="button-dark px-1 py-0.25 text-[0.75rem]" to="/reports">Open full report</Link>
    </div>
  );

  return (
    <CardFrame title="Fleet report" meta="Last 24 hours" actions={actions} bodyClassName="space-y-0.5 p-0.5 text-sm">
      {loading && !report ? <p className="text-slate-400">Loading fleet report…</p> : null}
      {error ? <p className="text-red-300">{error}</p> : null}
      {report ? (
        <>
          <div className="grid grid-cols-2 gap-0.5 md:grid-cols-4">
            <Metric label="Online" value={`${report.totals.onlineRoverCount}/${report.totals.roverCount}`} />
            <Metric label="Coverage" value={formatDuration(report.totals.coverageMs)} />
            <Metric label="Discharged" value={formatMah(report.totals.dischargedMah)} />
            <Metric label="Charged" value={formatMah(report.totals.chargedMah)} />
            <Metric label="Sensor samples" value={report.totals.sampleCount.toLocaleString()} />
            <Metric label="Telemetry gaps" value={report.totals.telemetryGapCount.toLocaleString()} />
            <Metric label="Distance" value={formatDistance(report.totals.distanceMm)} />
            <Metric label="Overcurrent episodes" value={report.totals.overcurrentEpisodeCount.toLocaleString()} />
            <Metric label="Warnings" value={report.totals.warningFindingCount.toLocaleString()} />
            <Metric label="Critical" value={report.totals.criticalFindingCount.toLocaleString()} />
          </div>
          {report.findings.length ? (
            <div className="surface space-y-0.5 px-1 py-0.5">
              <p className="text-xs font-semibold text-slate-200">Needs attention</p>
              {report.findings.slice(0, 5).map((finding) => (
                <div key={finding.key} className="flex items-start justify-between gap-1 text-xs">
                  <span className="text-slate-200">{finding.roverId ? `${finding.roverId}: ` : ''}{finding.title}</span>
                  <span className={finding.severity === 'critical' ? 'text-red-300' : finding.severity === 'warning' ? 'text-amber-300' : 'text-slate-400'}>
                    {finding.severity}
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="surface px-1 py-0.5 text-xs text-emerald-300">No report findings in this range.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400"><tr><th>Rover</th><th>State</th><th>Samples</th><th>Used</th><th>Temp max</th><th>Gaps</th></tr></thead>
              <tbody>
                {report.rovers.map((rover) => (
                  <tr key={rover.roverId} className="border-t border-neutral-700/70 text-slate-200">
                    <td>{rover.name}</td><td>{rover.online ? 'online' : 'offline'}</td>
                    <td>{rover.sampleCount.toLocaleString()}</td><td>{formatMah(rover.dischargedMah)}</td>
                    <td>{rover.maximumTemperatureC == null ? '--' : `${rover.maximumTemperatureC}°C`}</td><td>{rover.gapCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </CardFrame>
  );
}

export default function FleetReportsCard() {
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'fleetReports'));
  // The outer component owns the optional feature gate, while the enabled
  // child owns data hooks. This avoids opening report socket requests at all
  // when the server has disabled the feature and still lets layout stacks stay
  // completely unaware of feature branching.
  return enabled ? <EnabledFleetReportsCard /> : null;
}
