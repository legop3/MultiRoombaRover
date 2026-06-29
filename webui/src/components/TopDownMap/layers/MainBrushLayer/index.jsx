import React from 'react';
import { shallowObjectEqual } from '../../../../context/TelemetryContext.jsx';
import { MainBrushVisual } from '../../visuals.jsx';
import { rawNumber, useTopDownTelemetry } from '../layerTelemetry.js';

const EMPTY_MAIN_BRUSH_TELEMETRY = Object.freeze({
  mainBrushCurrentMa: 0,
  mainBrushOvercurrent: false,
  dirtDetectLeft: null,
  dirtDetect: null,
});

function selectMainBrushTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_MAIN_BRUSH_TELEMETRY;
  return {
    mainBrushCurrentMa: rawNumber(sensors.mainBrushCurrentMa, 0),
    mainBrushOvercurrent: Boolean(sensors.wheelOvercurrents?.mainBrush),
    dirtDetectLeft: rawNumber(sensors.dirtDetectLeft),
    dirtDetect: rawNumber(sensors.dirtDetect),
  };
}

function MainBrushLayer({ roverId, sensors, geometry, variant }) {
  const telemetry = useTopDownTelemetry(roverId, sensors, selectMainBrushTelemetry, shallowObjectEqual);

  return (
    <MainBrushVisual
      cx={geometry.centerX}
      cy={geometry.centerY}
      current={telemetry.mainBrushCurrentMa}
      overcurrent={telemetry.mainBrushOvercurrent}
      variant={variant}
      dirtLeft={telemetry.dirtDetectLeft}
      dirtRight={telemetry.dirtDetect}
    />
  );
}

export default React.memo(MainBrushLayer);
