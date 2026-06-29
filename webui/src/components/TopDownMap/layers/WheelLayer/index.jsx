import React from 'react';
import { shallowObjectEqual } from '../../../../context/TelemetryContext.jsx';
import { WheelVisual } from '../../visuals.jsx';
import { rawNumber, useTopDownTelemetry } from '../layerTelemetry.js';

const EMPTY_WHEEL_TELEMETRY = Object.freeze({
  wheelDropLeft: false,
  wheelDropRight: false,
  leftWheelOvercurrent: false,
  rightWheelOvercurrent: false,
  wheelLeftCurrentMa: 0,
  wheelRightCurrentMa: 0,
});

function selectWheelTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_WHEEL_TELEMETRY;
  const bumps = sensors.bumpsAndWheelDrops || {};
  const wheelOver = sensors.wheelOvercurrents || {};
  return {
    wheelDropLeft: Boolean(bumps.wheelDropLeft),
    wheelDropRight: Boolean(bumps.wheelDropRight),
    leftWheelOvercurrent: Boolean(wheelOver.leftWheel),
    rightWheelOvercurrent: Boolean(wheelOver.rightWheel),
    wheelLeftCurrentMa: rawNumber(sensors.wheelLeftCurrentMa, 0),
    wheelRightCurrentMa: rawNumber(sensors.wheelRightCurrentMa, 0),
  };
}

function WheelLayer({ roverId, sensors, geometry }) {
  const telemetry = useTopDownTelemetry(roverId, sensors, selectWheelTelemetry, shallowObjectEqual);

  return (
    <>
      <WheelVisual
        cx={geometry.centerX - geometry.wheelLineOffset}
        cy={geometry.centerY}
        current={telemetry.wheelLeftCurrentMa}
        drop={telemetry.wheelDropLeft}
        overcurrent={telemetry.leftWheelOvercurrent}
        label="L"
      />
      <WheelVisual
        cx={geometry.centerX + geometry.wheelLineOffset}
        cy={geometry.centerY}
        current={telemetry.wheelRightCurrentMa}
        drop={telemetry.wheelDropRight}
        overcurrent={telemetry.rightWheelOvercurrent}
        label="R"
      />
    </>
  );
}

export default React.memo(WheelLayer);
