// utils
// Purpose: Defines the utils module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { buildBatteryVisual } from '../../lib/battery.js';

export function formatDriverLabel({ roverId, session }) {
  const turn = session?.roster?.find((rover) => String(rover.id) === String(roverId))?.turn;
  const driver = turn?.queue?.find((entry) => entry.socketId === turn.currentId);
  const label = driver?.name || 'No driver';
  return label;
}

export function getBatteryVisual({ rover, frame }) {
  const charge = frame?.sensors?.batteryChargeMah ?? null;
  const config = rover?.battery ?? null;
  return buildBatteryVisual({ batteryState: rover?.batteryState ?? null, charge, config });
}
