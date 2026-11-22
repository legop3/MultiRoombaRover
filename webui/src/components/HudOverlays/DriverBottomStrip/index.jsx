import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import { batteryTelemetryEqual, selectBatteryState } from '../../../context/telemetryViews.js';
import LightBumpBars from '../LightBumpBars/index.jsx';
import { buildBatteryVisual } from '../../../lib/battery.js';
import BatteryBar from '../../BatteryBar/index.jsx';

export default function DriverBottomStrip({ roverId = null, mobileHud = false }) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const batteryState = useVisualTelemetrySelector(effectiveRoverId, selectBatteryState, batteryTelemetryEqual);
  const batteryVisual = buildBatteryVisual({ batteryState });

  return (
    <div className="space-y-0.5">
      <LightBumpBars roverId={effectiveRoverId} />
      <div className="space-y-0.5 text-sm">
        <BatteryBar visual={batteryVisual} compact={mobileHud} />
      </div>
    </div>
  );
}
