// Low Battery Overlay
// Purpose: Defines the Low Battery Overlay module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React from 'react';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import { batteryTelemetryEqual, selectBatteryTelemetry } from '../../../context/telemetryViews.js';
import { buildBatteryVisual } from '../../../lib/battery.js';

function LowBatteryOverlay({ roverId = null, sensors, batteryConfig, compact = false }) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const batteryTelemetry = useVisualTelemetrySelector(effectiveRoverId, selectBatteryTelemetry, batteryTelemetryEqual);
  const rosterBatteryConfig = useSessionSelector((state) => {
    if (!effectiveRoverId) return null;
    const roster = state.session?.roster || [];
    const rover = roster.find((entry) => String(entry.id) === String(effectiveRoverId));
    return rover?.battery ?? null;
  });
  const resolvedBatteryTelemetry = sensors
    ? {
        batteryChargeMah: sensors?.batteryChargeMah ?? null,
        batteryCapacityMah: sensors?.batteryCapacityMah ?? null,
      }
    : batteryTelemetry;
  const resolvedBatteryConfig = batteryConfig ?? rosterBatteryConfig;
  const battery = buildBatteryVisual({
    charge: resolvedBatteryTelemetry?.batteryChargeMah ?? null,
    config: resolvedBatteryConfig,
  });
  if (!battery?.available) return null;
  if (!battery.warnActive && !battery.urgentActive) return null;

  const message = battery.urgentActive
    ? 'BATTERY VERY LOW, DOCK THE ROVER AND CHARGE IMMEDIATELY!!'
    : 'Battery low! please dock and charge the rover soon.';

  const containerClass = compact ? 'p-2 top-6' : 'p-4 top-10';
  const textClass = compact ? 'text-sm' : 'text-2xl';

  return (
    <div
      className={`pointer-events-none absolute flex items-center justify-center bg-amber-900/60 left-1/2 -translate-x-1/2 ${containerClass}`}
    >
      <div className={`text-center font-semibold text-white animate-pulse ${textClass}`}>
        <div>{message}</div>
      </div>
    </div>
  );
}

export default React.memo(LowBatteryOverlay);
