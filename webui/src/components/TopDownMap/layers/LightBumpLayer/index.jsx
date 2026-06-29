import React from 'react';
import { shallowArrayEqual } from '../../../../context/TelemetryContext.jsx';
import { lightBumpColor } from '../../helpers.js';
import { ConeSegment } from '../../visuals.jsx';
import { rawNumber, useTopDownTelemetry } from '../layerTelemetry.js';

const EMPTY_LIGHT_BUMP_TELEMETRY = Object.freeze([null, null, null, null, null, null]);

function selectLightBumpTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_LIGHT_BUMP_TELEMETRY;
  return [
    rawNumber(sensors.lightBumpLeftSignal),
    rawNumber(sensors.lightBumpFrontLeftSignal),
    rawNumber(sensors.lightBumpCenterLeftSignal),
    rawNumber(sensors.lightBumpCenterRightSignal),
    rawNumber(sensors.lightBumpFrontRightSignal),
    rawNumber(sensors.lightBumpRightSignal),
  ];
}

function LightBumpLayer({ roverId, sensors, geometry }) {
  const lightValues = useTopDownTelemetry(roverId, sensors, selectLightBumpTelemetry, shallowArrayEqual);
  const lightMaxSamples = lightValues.filter((value) => value != null);
  const maxLight = lightMaxSamples.length ? Math.max(...lightMaxSamples, 1200) : 1200;

  return (
    <>
      {geometry.lightSegments.map((seg, idx) => {
        const value = lightValues[idx];
        const color = lightBumpColor(value, maxLight);
        const tipR = geometry.lightRingOuter + 4;
        const baseR = tipR + 28;
        return (
          <ConeSegment
            key={seg.label}
            cx={geometry.centerX}
            cy={geometry.centerY}
            rBase={baseR}
            rTip={tipR}
            startDeg={seg.start}
            endDeg={seg.end}
            color={color}
            value={value}
            max={maxLight}
          />
        );
      })}
    </>
  );
}

export default React.memo(LightBumpLayer);
