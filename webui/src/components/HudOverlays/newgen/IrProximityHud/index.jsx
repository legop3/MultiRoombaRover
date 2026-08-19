// New Generation IR Proximity HUD
// Purpose: Projects the six light-bump sensors as cones above their physical bumper positions.
// Scope: Mirrors the top-down map's signal geometry without retaining history or smoothing telemetry.
import { memo } from 'react';
import { useVisualTelemetrySelector } from '../../../../context/TelemetryContext.jsx';
import {
  lightBumpTelemetryEqual,
  selectLightBumpTelemetry,
} from '../../../../context/telemetryViews.js';
import { IR_SENSOR_GEOMETRY } from '../BottomSensorHud/geometry.js';
import './styles.css';

const IR_NOISE_THRESHOLD = 40;
const IR_FULL_STRENGTH = 1200;
const FAR_CONE_LENGTH = 105;
const NEAR_CONE_LENGTH = 12;
const STRIPE_COUNT = 7;
const FADE_IN_RANGE = 0.1;
const MAX_CONE_OPACITY = 1;
const RED_POINT = 0.75;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function buildStripePath(sensor, length) {
  const perpendicularX = -sensor.directionY;
  const perpendicularY = sensor.directionX;

  /*
    Keep all seven stripes in one multi-subpath so the browser still manages
    only one SVG path per sensor. This function runs only for the memoized
    sensor whose raw value changed, preserving the exact tuned width and length
    geometry without reconciling 42 separate elements.
  */
  return Array.from({ length: STRIPE_COUNT }, (_, index) => {
    const fraction = (index + 1) / STRIPE_COUNT;
    const stripeDistance = length * fraction;
    const centerX = sensor.tipX + sensor.directionX * stripeDistance;
    const centerY = sensor.tipY + sensor.directionY * stripeDistance;
    const halfWidth = (sensor.width * fraction) / 2;
    const leftX = centerX + perpendicularX * halfWidth;
    const leftY = centerY + perpendicularY * halfWidth;
    const rightX = centerX - perpendicularX * halfWidth;
    const rightY = centerY - perpendicularY * halfWidth;
    const curveDepth = Math.max(1.5, length * 0.045 * fraction);
    const controlX = centerX + sensor.directionX * curveDepth;
    const controlY = centerY + sensor.directionY * curveDepth;
    return `M ${leftX} ${leftY} Q ${controlX} ${controlY} ${rightX} ${rightY}`;
  }).join(' ');
}

function buildPresentation(value) {
  const numericValue = Number(value) || 0;
  const active = numericValue > IR_NOISE_THRESHOLD;
  const normalized = clamp01(
    (numericValue - IR_NOISE_THRESHOLD) / (IR_FULL_STRENGTH - IR_NOISE_THRESHOLD),
  );
  /*
    Match the top-down map's display curve. This is an instantaneous spatial
    mapping, not temporal smoothing: the current raw value alone determines the
    cone length for this frame.
  */
  const eased = Math.pow(normalized, 0.35);
  const length = FAR_CONE_LENGTH - (FAR_CONE_LENGTH - NEAR_CONE_LENGTH) * eased;
  const colorStrength = clamp01(normalized / RED_POINT);

  return {
    length,
    /* Color reaches red independently of distance, making its warning point directly tunable. */
    color: `hsl(${120 * (1 - colorStrength)} 90% 50%)`,
    /*
      Opacity is driven by the raw sensor range, not merely by a CSS transition.
      The first fifth of the usable range fades the cone from invisible to its
      normal opacity before distance and color become the dominant cues.
    */
    opacity: active ? clamp01(normalized / FADE_IN_RANGE) * MAX_CONE_OPACITY : 0,
  };
}

const IrSensorCone = memo(function IrSensorCone({ sensor, value }) {
  const presentation = buildPresentation(value);
  const stripePath = buildStripePath(sensor, presentation.length);

  return (
    <path
      d={stripePath}
      className="newgen-ir-proximity-cone"
      stroke={presentation.color}
      style={{ opacity: presentation.opacity }}
    />
  );
});

export default function IrProximityHud({ roverId }) {
  const values = useVisualTelemetrySelector(
    roverId,
    selectLightBumpTelemetry,
    lightBumpTelemetryEqual,
  );

  return (
    <g className="newgen-ir-proximity" aria-label="Front infrared proximity sensors">
      {IR_SENSOR_GEOMETRY.map((sensor, index) => (
        <IrSensorCone key={sensor.key} sensor={sensor} value={values[index]} />
      ))}
    </g>
  );
}
