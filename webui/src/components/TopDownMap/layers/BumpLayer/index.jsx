import React from 'react';
import { shallowObjectEqual } from '../../../../context/TelemetryContext.jsx';
import { ArcSegment } from '../../visuals.jsx';
import { useTopDownTelemetry } from '../layerTelemetry.js';

const EMPTY_BUMP_TELEMETRY = Object.freeze({
  bumpLeft: false,
  bumpRight: false,
});

function selectBumpTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_BUMP_TELEMETRY;
  const bumps = sensors.bumpsAndWheelDrops || {};
  return {
    bumpLeft: Boolean(bumps.bumpLeft),
    bumpRight: Boolean(bumps.bumpRight),
  };
}

function BumpLayer({ roverId, sensors, geometry }) {
  const telemetry = useTopDownTelemetry(roverId, sensors, selectBumpTelemetry, shallowObjectEqual);
  const bumpDepress = 6;
  const bumpLeftOffset = telemetry.bumpLeft ? bumpDepress : 0;
  const bumpRightOffset = telemetry.bumpRight ? bumpDepress : 0;

  return (
    <>
      <ArcSegment
        cx={geometry.centerX}
        cy={geometry.centerY}
        rInner={geometry.lightRingInner - bumpLeftOffset}
        rOuter={geometry.lightRingOuter - bumpLeftOffset}
        startDeg={-70}
        endDeg={-6}
        color={telemetry.bumpLeft ? '#ef4444' : '#475569'}
        opacity={1}
        pulse={Boolean(telemetry.bumpLeft)}
      />
      <ArcSegment
        cx={geometry.centerX}
        cy={geometry.centerY}
        rInner={geometry.lightRingInner - bumpRightOffset}
        rOuter={geometry.lightRingOuter - bumpRightOffset}
        startDeg={6}
        endDeg={70}
        color={telemetry.bumpRight ? '#ef4444' : '#475569'}
        opacity={1}
        pulse={Boolean(telemetry.bumpRight)}
      />
    </>
  );
}

export default React.memo(BumpLayer);
