import React from 'react';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import { batteryTelemetryEqual, selectBatteryTelemetry } from '../../../context/telemetryViews.js';
import { buildBatteryVisual } from '../../../lib/battery.js';
import BatteryBar from '../../BatteryBar/index.jsx';

function VerticalBatteryOverlay({ show = false, roverId = null, sensors, batteryConfig, mobileHud = false }) {
  const batteryTelemetry = useVisualTelemetrySelector(roverId, selectBatteryTelemetry, batteryTelemetryEqual);
  const rosterBatteryConfig = useSessionSelector((state) => {
    if (!roverId) return null;
    const roster = state.session?.roster || [];
    const rover = roster.find((entry) => String(entry.id) === String(roverId));
    return rover?.battery ?? null;
  });
  const resolvedBatteryTelemetry = sensors
    ? {
        batteryChargeMah: sensors?.batteryChargeMah ?? null,
        batteryCapacityMah: sensors?.batteryCapacityMah ?? null,
      }
    : batteryTelemetry;
  const resolvedBatteryConfig = batteryConfig ?? rosterBatteryConfig;
  const batteryVisual = buildBatteryVisual({
    charge: resolvedBatteryTelemetry?.batteryChargeMah ?? null,
    config: resolvedBatteryConfig,
  });
  if (!show || !batteryVisual?.available) return null;

  return (
    <div className="pointer-events-none absolute right-1 top-1/2 flex h-[70%] -translate-y-1/2 flex-col items-center justify-center rounded bg-black/60 px-0.5 pb-1 pt-1">
      <BatteryBar
        visual={batteryVisual}
        orientation="vertical"
        variant="inline"
        compact={mobileHud}
        className="h-full w-4"
      />
    </div>
  );
}

export default React.memo(VerticalBatteryOverlay);
