import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useTelemetryFrame } from '../../../context/TelemetryContext.jsx';
import LightBumpBars from '../LightBumpBars/index.jsx';
import { buildBatteryVisual } from '../../../lib/battery.js';
import BatteryBar from '../../BatteryBar/index.jsx';

export default function DriverBottomStrip({ roverId = null, mobileHud = false }) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const frame = useTelemetryFrame(effectiveRoverId);
  const sensors = frame?.sensors ?? null;
  const batteryConfig = useSessionSelector((state) => {
    if (!effectiveRoverId) return null;
    const roster = state.session?.roster || [];
    const rover = roster.find((entry) => String(entry.id) === String(effectiveRoverId));
    return rover?.battery ?? null;
  });
  const batteryVisual = buildBatteryVisual({
    charge: sensors?.batteryChargeMah ?? null,
    config: batteryConfig,
  });

  return (
    <div className="space-y-0.5">
      <LightBumpBars roverId={effectiveRoverId} />
      <div className="panel-section space-y-0.5 text-sm">
        <BatteryBar visual={batteryVisual} compact={mobileHud} />
      </div>
    </div>
  );
}
