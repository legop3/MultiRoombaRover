// New Generation Cliff Indicators
// Purpose: Projects the four underside cliff sensors just below the front bumper curve.
// Scope: Uses the rover's cliff booleans directly without interpreting raw cliff signal values.
import { useId } from 'react';
import {
  shallowObjectEqual,
  useVisualTelemetrySelector,
} from '../../../../context/TelemetryContext.jsx';
import { CLIFF_ARCS } from '../BottomSensorHud/geometry.js';
import './styles.css';

const EMPTY_CLIFFS = Object.freeze({
  left: false,
  frontLeft: false,
  frontRight: false,
  right: false,
});

function selectCliffs(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_CLIFFS;
  return {
    left: Boolean(sensors.cliffLeft),
    frontLeft: Boolean(sensors.cliffFrontLeft),
    frontRight: Boolean(sensors.cliffFrontRight),
    right: Boolean(sensors.cliffRight),
  };
}

function ActiveCliffArc({ pathId, path }) {
  return (
    <g>
      <path id={pathId} d={path} className="newgen-cliff-path" />
      <text className="newgen-cliff-label" dy="0.35em">
        <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
          CLIFF
        </textPath>
      </text>
    </g>
  );
}

export default function CliffIndicators({ roverId }) {
  const cliffs = useVisualTelemetrySelector(roverId, selectCliffs, shallowObjectEqual);
  const instanceId = useId().replaceAll(':', '');
  if (!Object.values(cliffs).some(Boolean)) return null;

  return (
    <g className="newgen-cliff-visual" aria-label="Active rover cliff sensors">
      {CLIFF_ARCS.map((sensor) => (
        cliffs[sensor.key] ? (
          <ActiveCliffArc
            key={sensor.key}
            pathId={`${instanceId}-${sensor.key}-cliff`}
            path={sensor.path}
          />
        ) : null
      ))}
    </g>
  );
}
