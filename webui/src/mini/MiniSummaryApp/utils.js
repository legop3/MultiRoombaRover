// utils
// Purpose: Defines the utils module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { buildBatteryVisual } from '../../lib/battery.js';

export function formatDriverLabel({ roverId, session }) {
  const activeDriverId = session?.activeDrivers?.[roverId] || null;
  const user = (session?.users || []).find((entry) => entry.socketId === activeDriverId);
  const label = user?.nickname || (activeDriverId ? activeDriverId.slice(0, 6) : 'No driver');
  const mode = session?.mode;
  const turnInfo = session?.turnQueues?.[roverId];
  return mode === 'turns' && turnInfo?.current ? `${label}` : label;
}

export function getBatteryVisual({ rover, frame }) {
  const charge = frame?.sensors?.batteryChargeMah ?? null;
  const config = rover?.battery ?? null;
  return buildBatteryVisual({ batteryState: rover?.batteryState ?? null, charge, config });
}
