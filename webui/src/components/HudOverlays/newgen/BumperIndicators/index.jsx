// New Generation Bumper Indicators
// Purpose: Projects the rover's two physical bumper halves across the bottom of the video.
// Scope: Visualizes server telemetry only; it does not infer collisions or change control behavior.
import { useId } from 'react';
import {
  shallowObjectEqual,
  useVisualTelemetrySelector,
} from '../../../../context/TelemetryContext.jsx';
import { LEFT_BUMPER_PATH, RIGHT_BUMPER_PATH } from '../BottomSensorHud/geometry.js';
import './styles.css';

const EMPTY_BUMPERS = Object.freeze({ bumpLeft: false, bumpRight: false });

function selectBumpers(frame) {
  const contact = frame?.sensors?.bumpsAndWheelDrops;
  if (!contact) return EMPTY_BUMPERS;
  return {
    bumpLeft: Boolean(contact.bumpLeft),
    bumpRight: Boolean(contact.bumpRight),
  };
}

function ActiveBumperArc({ pathId, path, label }) {
  return (
    <g className="newgen-bumper-arc">
      {/*
        The broad rounded stroke uses the same visual idea as TopDownMap's
        ArcSegment, while this wider quadratic path is shaped for the camera
        viewport instead of the circular top-down rover geometry.
      */}
      <path id={pathId} d={path} className="newgen-bumper-path" />
      <text className="newgen-bumper-label" dy="0.35em">
        <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
          {label}
        </textPath>
      </text>
    </g>
  );
}

export default function BumperIndicators({ roverId }) {
  const telemetry = useVisualTelemetrySelector(roverId, selectBumpers, shallowObjectEqual);
  const instanceId = useId().replaceAll(':', '');
  if (!telemetry.bumpLeft && !telemetry.bumpRight) return null;

  return (
    <g className="newgen-bumper-visual" aria-label="Active rover bumper sensors">
      {telemetry.bumpLeft ? (
        <ActiveBumperArc pathId={`${instanceId}-left-bumper`} path={LEFT_BUMPER_PATH} label="BUMPER" />
      ) : null}
      {telemetry.bumpRight ? (
        <ActiveBumperArc pathId={`${instanceId}-right-bumper`} path={RIGHT_BUMPER_PATH} label="BUMPER" />
      ) : null}
    </g>
  );
}
