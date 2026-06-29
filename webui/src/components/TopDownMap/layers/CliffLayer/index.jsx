import React from 'react';
import { shallowObjectEqual } from '../../../../context/TelemetryContext.jsx';
import { CurvedArcBar } from '../../visuals.jsx';
import { rawNumber, useTopDownTelemetry } from '../layerTelemetry.js';

const EMPTY_CLIFF_TELEMETRY = Object.freeze({
  cliffLeftSignal: null,
  cliffFrontLeftSignal: null,
  cliffFrontRightSignal: null,
  cliffRightSignal: null,
  cliffLeft: false,
  cliffFrontLeft: false,
  cliffFrontRight: false,
  cliffRight: false,
});

function selectCliffTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_CLIFF_TELEMETRY;
  return {
    cliffLeftSignal: rawNumber(sensors.cliffLeftSignal),
    cliffFrontLeftSignal: rawNumber(sensors.cliffFrontLeftSignal),
    cliffFrontRightSignal: rawNumber(sensors.cliffFrontRightSignal),
    cliffRightSignal: rawNumber(sensors.cliffRightSignal),
    cliffLeft: Boolean(sensors.cliffLeft),
    cliffFrontLeft: Boolean(sensors.cliffFrontLeft),
    cliffFrontRight: Boolean(sensors.cliffFrontRight),
    cliffRight: Boolean(sensors.cliffRight),
  };
}

function cliffSignalPercent(value) {
  // Create cliff signals are unsigned 12-bit-ish analog values in this stream.
  // The curved bar shows the raw signal magnitude as fill amount, while the
  // cliff boolean controls the danger background separately.
  if (value == null || !Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(1, Number(value) / 4095));
}

function CliffLayer({ roverId, sensors, geometry }) {
  const telemetry = useTopDownTelemetry(roverId, sensors, selectCliffTelemetry, shallowObjectEqual);

  return (
    <>
      {geometry.cliffSegments.map((seg) => (
        <CurvedArcBar
          key={seg.label}
          cx={geometry.centerX}
          cy={geometry.centerY}
          rInner={geometry.cliffRingInner}
          rOuter={geometry.cliffRingOuter}
          startDeg={seg.start}
          endDeg={seg.end}
          percent={cliffSignalPercent(telemetry[seg.valueKey])}
          backgroundColor={telemetry[seg.activeKey] ? '#7f1d1d' : '#334155'}
          fillColor={telemetry[seg.activeKey] ? '#fbbf24' : '#f59e0b'}
          fillFromEnd={seg.fillFromEnd}
        />
      ))}
    </>
  );
}

export default React.memo(CliffLayer);
