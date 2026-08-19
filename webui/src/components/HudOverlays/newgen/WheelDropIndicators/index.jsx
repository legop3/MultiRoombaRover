// New Generation Wheel Drop Indicators
// Purpose: Mirrors the top-down map's red wheel overlay at the left and right video edges.
// Scope: Displays the two physical wheel-drop booleans without generic HUD chrome or control behavior.
import {
  shallowObjectEqual,
  useVisualTelemetrySelector,
} from '../../../../context/TelemetryContext.jsx';
import './styles.css';

const EMPTY_WHEEL_DROPS = Object.freeze({ left: false, right: false });

function selectWheelDrops(frame) {
  const contact = frame?.sensors?.bumpsAndWheelDrops;
  if (!contact) return EMPTY_WHEEL_DROPS;
  return {
    left: Boolean(contact.wheelDropLeft),
    right: Boolean(contact.wheelDropRight),
  };
}

function WheelDropOverlay({ side }) {
  return (
    <div
      className={`newgen-wheel-drop newgen-wheel-drop--${side}`}
      role="alert"
      aria-label={`${side} wheel off ground`}
    >
      {/* Mirrored rotation follows the left/right text orientation used by TopDownMap's wheel glyphs. */}
      <span>WHEEL OFF GROUND</span>
    </div>
  );
}

export default function WheelDropIndicators({ roverId }) {
  const drops = useVisualTelemetrySelector(roverId, selectWheelDrops, shallowObjectEqual);

  return (
    <>
      {drops.left ? <WheelDropOverlay side="left" /> : null}
      {drops.right ? <WheelDropOverlay side="right" /> : null}
    </>
  );
}
