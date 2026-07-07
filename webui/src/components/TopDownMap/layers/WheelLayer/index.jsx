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
  wheelLeftSpeedMmPerSecond: null,
  wheelRightSpeedMmPerSecond: null,
});

function selectWheelTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_WHEEL_TELEMETRY;
  const bumps = sensors.bumpsAndWheelDrops || {};
  const wheelOver = sensors.wheelOvercurrents || {};
  const wheelSpeeds = sensors.wheelSpeedsMmPerSecond || {};
  return {
    wheelDropLeft: Boolean(bumps.wheelDropLeft),
    wheelDropRight: Boolean(bumps.wheelDropRight),
    leftWheelOvercurrent: Boolean(wheelOver.leftWheel),
    rightWheelOvercurrent: Boolean(wheelOver.rightWheel),
    wheelLeftCurrentMa: rawNumber(sensors.wheelLeftCurrentMa, 0),
    wheelRightCurrentMa: rawNumber(sensors.wheelRightCurrentMa, 0),
    /*
      Speed is synthesized on the server from encoder deltas, so it can be null
      on the first frame or after an ignored encoder jump. Keeping null distinct
      from 0 lets the wheel visual show "no valid speed sample" without making
      an unknown state look like a stopped rover.
    */
    wheelLeftSpeedMmPerSecond: rawNumber(wheelSpeeds.left, null),
    wheelRightSpeedMmPerSecond: rawNumber(wheelSpeeds.right, null),
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
        speed={telemetry.wheelLeftSpeedMmPerSecond}
        drop={telemetry.wheelDropLeft}
        overcurrent={telemetry.leftWheelOvercurrent}
        label="L"
      />
      <WheelVisual
        cx={geometry.centerX + geometry.wheelLineOffset}
        cy={geometry.centerY}
        current={telemetry.wheelRightCurrentMa}
        speed={telemetry.wheelRightSpeedMmPerSecond}
        drop={telemetry.wheelDropRight}
        overcurrent={telemetry.rightWheelOvercurrent}
        label="R"
      />
    </>
  );
}

export default React.memo(WheelLayer);
