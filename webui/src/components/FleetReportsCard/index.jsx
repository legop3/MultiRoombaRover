// Fleet Reports Card
// Purpose: Shows every rover's key battery and efficiency metrics at the bottom of Activities.
// Scope: Self-gates through session.features and links to the all-rovers fullscreen report.
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import useFleetReport from '../../hooks/useFleetReport.js';
import CardFrame from '../CardFrame/index.jsx';

function value(number, digits = 1) {
  return Number.isFinite(Number(number))
    ? Number(number).toLocaleString(undefined, { maximumFractionDigits: digits })
    : '--';
}

function distance(millimeters) {
  return Number(millimeters) >= 1e6
    ? `${value(Number(millimeters) / 1e6, 2)} km`
    : `${value(Number(millimeters) / 1000, 1)} m`;
}

function EnabledFleetReportsCard() {
  const [now, setNow] = useState(() => Date.now());
  const { report, loading, error } = useFleetReport({
    since: now - 24 * 60 * 60 * 1000,
    until: now,
    compact: true,
    includeEvents: false,
  });
  return (
    <CardFrame
      title="Fleet battery and efficiency"
      meta="Last 24 hours"
      actions={<div className="flex gap-0.5"><button type="button" className="button-dark px-1 py-0.25 text-[0.75rem]" onClick={() => setNow(Date.now())}>Refresh</button><Link className="button-dark px-1 py-0.25 text-[0.75rem]" to="/reports">Open full report</Link></div>}
      bodyClassName="space-y-0.5 p-0.5 text-sm"
    >
      {loading && !report ? <p className="text-slate-400">Loading fleet metrics…</p> : null}
      {error ? <p className="text-red-300">{error}</p> : null}
      {report ? (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="text-slate-400"><tr><th>Rover</th><th>State</th><th>Health</th><th>Confidence</th><th>Wh/km</th><th>Distance</th><th>Used</th><th>Temperature</th></tr></thead>
            <tbody>{report.rovers.map((rover) => (
              <tr key={rover.roverId} className="border-t border-neutral-700/70 text-slate-200">
                <td>{rover.name}</td><td>{rover.online ? 'online' : 'offline'}</td>
                <td>{rover.batteryHealth.capacityRetentionPercent == null ? '--' : `${value(rover.batteryHealth.capacityRetentionPercent)}%`}</td>
                <td>{rover.batteryHealth.confidence}</td><td>{value(rover.overallWhPerKm)}</td>
                <td>{distance(rover.distanceMm)}</td><td>{value(rover.dischargedWh, 2)} Wh</td>
                <td>{value(rover.maximumTemperatureC)} °C</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </CardFrame>
  );
}

export default function FleetReportsCard() {
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'fleetReports'));
  /*
    Keeping the hook inside the enabled child ensures a disabled optional
    feature creates no socket traffic and leaves the Activities layout unaware
    of reporting internals.
  */
  return enabled ? <EnabledFleetReportsCard /> : null;
}
