import React from 'react';
import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import { batteryTelemetryEqual, selectBatteryState } from '../../../context/telemetryViews.js';
import { buildBatteryVisual } from '../../../lib/battery.js';
import BatteryBar from '../../BatteryBar/index.jsx';

function VerticalBatteryOverlay({ show = false, roverId = null, mobileHud = false }) {
  const batteryState = useVisualTelemetrySelector(roverId, selectBatteryState, batteryTelemetryEqual);
  const batteryVisual = buildBatteryVisual({ batteryState });
  if (!show || !batteryVisual?.available) return null;

  return (
    <div className="pointer-events-none absolute right-1 top-1/2 flex h-[70%] -translate-y-1/2 flex-col items-center justify-center rounded-sm bg-black/60 px-0.5 pb-1 pt-1">
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
