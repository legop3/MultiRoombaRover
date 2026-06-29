import React from 'react';
import { shallowObjectEqual } from '../../../../context/TelemetryContext.jsx';
import { SideBrushVisual } from '../../visuals.jsx';
import { rawNumber, useTopDownTelemetry } from '../layerTelemetry.js';

const EMPTY_SIDE_BRUSH_TELEMETRY = Object.freeze({
  sideBrushCurrentMa: 0,
  sideBrushOvercurrent: false,
});

function selectSideBrushTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_SIDE_BRUSH_TELEMETRY;
  return {
    sideBrushCurrentMa: rawNumber(sensors.sideBrushCurrentMa, 0),
    sideBrushOvercurrent: Boolean(sensors.wheelOvercurrents?.sideBrush),
  };
}

function SideBrushLayer({ roverId, sensors, geometry }) {
  const telemetry = useTopDownTelemetry(roverId, sensors, selectSideBrushTelemetry, shallowObjectEqual);

  return (
    <SideBrushVisual
      cx={geometry.centerX + geometry.innerCircle * 0.65}
      cy={geometry.centerY - geometry.innerCircle * 0.55}
      current={telemetry.sideBrushCurrentMa}
      overcurrent={telemetry.sideBrushOvercurrent}
    />
  );
}

export default React.memo(SideBrushLayer);
