import React from 'react';
import { shallowObjectEqual } from '../../../../context/TelemetryContext.jsx';
import { ReadoutBar } from '../../visuals.jsx';
import { rawNumber, useTopDownTelemetry } from '../layerTelemetry.js';

const EMPTY_ELECTRICAL_TELEMETRY = Object.freeze({
  voltageMv: null,
  currentMa: null,
  chargingStateLabel: '',
});

function selectElectricalTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_ELECTRICAL_TELEMETRY;
  return {
    voltageMv: rawNumber(sensors.voltageMv),
    currentMa: rawNumber(sensors.currentMa),
    chargingStateLabel: sensors.chargingState?.label || '',
  };
}

function formatVoltage(voltageMv) {
  if (voltageMv == null || !Number.isFinite(Number(voltageMv))) return '--.-V';
  return `${(Number(voltageMv) / 1000).toFixed(1)}V`;
}

function formatCurrent(currentMa) {
  if (currentMa == null || !Number.isFinite(Number(currentMa))) return '---mA';
  const current = Number(currentMa);
  const prefix = current > 0 ? '+' : '';
  return `${prefix}${Math.round(current)}mA`;
}

function voltagePercent(voltageMv) {
  // This is intentionally a display range, not battery-health logic. A Create
  // 2-class pack usually lives around the mid-teens in volts, so 12-17V gives
  // the tiny map bar useful movement without pretending to be a precise fuel
  // gauge. The real battery percent remains handled by the dedicated battery UI.
  if (voltageMv == null || !Number.isFinite(Number(voltageMv))) return 0;
  return clampDisplay((Number(voltageMv) - 12000) / 5000);
}

function currentPercent(currentMa) {
  // Current changes sign depending on charge/discharge direction, but the bar
  // is meant to show load magnitude. The signed text beside it preserves the
  // actual direction while the fill gives a quick "how much is happening" cue.
  if (currentMa == null || !Number.isFinite(Number(currentMa))) return 0;
  return clampDisplay(Math.abs(Number(currentMa)) / 2500);
}

function clampDisplay(value) {
  return Math.max(0, Math.min(1, value));
}

function ElectricalReadoutLayer({ roverId, sensors, geometry }) {
  const telemetry = useTopDownTelemetry(roverId, sensors, selectElectricalTelemetry, shallowObjectEqual);

  return (
    <>
      <ReadoutBar
        x={geometry.voltageReadout.x}
        y={geometry.voltageReadout.y}
        width={geometry.voltageReadout.width}
        height={geometry.voltageReadout.height}
        label={telemetry.chargingStateLabel || 'unknown'}
        valueText={formatVoltage(telemetry.voltageMv)}
        percent={voltagePercent(telemetry.voltageMv)}
        color="#38bdf8"
        missing={telemetry.voltageMv == null}
      />
      <ReadoutBar
        x={geometry.currentReadout.x}
        y={geometry.currentReadout.y}
        width={geometry.currentReadout.width}
        height={geometry.currentReadout.height}
        label="current"
        valueText={formatCurrent(telemetry.currentMa)}
        percent={currentPercent(telemetry.currentMa)}
        color={Number(telemetry.currentMa) < 0 ? '#f59e0b' : '#22c55e'}
        missing={telemetry.currentMa == null}
      />
    </>
  );
}

export default React.memo(ElectricalReadoutLayer);
