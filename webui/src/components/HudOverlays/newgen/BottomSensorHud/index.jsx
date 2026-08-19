// New Generation Bottom Sensor HUD
// Purpose: Gives all bottom sensor visuals one SVG coordinate space and one physical curve.
// Scope: Owns shared placement only; child components retain independent telemetry subscriptions.
import BumperIndicators from '../BumperIndicators/index.jsx';
import IrProximityHud from '../IrProximityHud/index.jsx';
import CliffIndicators from '../CliffIndicators/index.jsx';
import { SENSOR_HUD_VIEW_BOX } from './geometry.js';
import './styles.css';

export default function BottomSensorHud({ roverId }) {
  return (
    <svg
      className="newgen-bottom-sensor-hud"
      viewBox={SENSOR_HUD_VIEW_BOX}
      preserveAspectRatio="none"
      role="img"
      aria-label="Rover front sensors"
    >
      <IrProximityHud roverId={roverId} />
      <BumperIndicators roverId={roverId} />
      <CliffIndicators roverId={roverId} />
    </svg>
  );
}
