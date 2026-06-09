// Server Display Utilities
// Purpose: Supplies small formatting helpers shared by the room display components.
// Scope: Keeps the display route focused on presentation while still using the same
// session, roster, and battery data shapes as the rest of the web UI.
import { buildBatteryVisual } from '../../lib/battery.js';

export function formatUserName(user) {
  // The room display is read from a distance, so every user needs a short stable
  // label even when they have not set a nickname. Socket ids are noisy, but the
  // first six characters match existing UI behavior and are enough to distinguish
  // temporary visitors in the room.
  return String(user?.nickname || user?.socketId?.slice(0, 6) || 'unknown').trim();
}

export function findDriverForRover({ roverId, session }) {
  const activeDriverId = session?.activeDrivers?.[roverId] || null;
  if (!activeDriverId) return null;
  const user = (session?.users || []).find((entry) => entry.socketId === activeDriverId);
  return {
    socketId: activeDriverId,
    label: formatUserName(user || { socketId: activeDriverId }),
  };
}

export function getDisplayBatteryVisual({ rover, frame }) {
  // Roster battery state is the normal fast path because the server already
  // classifies warning/urgent thresholds. Telemetry charge is included as a
  // fallback so the display still gets a useful percentage if the roster state
  // arrives before the richer battery snapshot is populated.
  return buildBatteryVisual({
    batteryState: rover?.batteryState ?? null,
    charge: frame?.sensors?.batteryChargeMah ?? null,
    config: rover?.battery ?? null,
  });
}

export function formatBatteryText(visual) {
  if (!visual?.available) return '--';
  if (visual.urgentActive) return `${visual.percentDisplay}% Low`;
  if (visual.warnActive) return `${visual.percentDisplay}% Low`;
  return `${visual.percentDisplay}%`;
}

export function buildRoverStateText(rover, visual) {
  const states = [];
  if (rover?.private?.enabled && rover?.private?.open) states.push('Private');
  if (visual?.urgentActive || visual?.warnActive) states.push('Low');
  // Only exceptional state belongs here. The normal driver/id/battery lines
  // already consume the big readable space, and extra routine labels make this
  // utility board harder to scan from across the room.
  return states.join(' · ');
}

export function gridClassForRoverCount(count) {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count === 4) return 'grid-cols-2';
  return 'grid-cols-3';
}
