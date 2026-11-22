// Telemetry Views
// Purpose: Defines small, stable telemetry projections for UI components.
// Scope: Keeps rendering subscriptions focused on the sensor fields each view actually uses.

import { shallowArrayEqual, shallowObjectEqual } from './TelemetryContext.jsx';

const EMPTY_BATTERY_TELEMETRY = Object.freeze({
  batteryChargeMah: null,
  batteryCapacityMah: null,
  batteryVoltage: null,
});





const EMPTY_HOST_STATS = Object.freeze({});
const EMPTY_OVERCURRENT_FLAGS = Object.freeze({
  leftWheel: false,
  rightWheel: false,
  mainBrush: false,
  sideBrush: false,
});
const EMPTY_MAIN_BRUSH_AUDIO = Object.freeze({
  mainBrushCurrentMa: 0,
  mainBrushOvercurrent: false,
});

function bucketNumber(value, step) {
  // Visual widgets do not benefit from repainting for tiny analog jitter. The
  // bucket step intentionally applies only to display selectors; raw telemetry
  // remains available through useTelemetryFrame for control and debugging code.
  if (value == null || !Number.isFinite(Number(value))) return value ?? null;
  return Math.round(Number(value) / step) * step;
}

function sensorNumber(value) {
  // Some visual sensors, especially light bumps, need every reported value to
  // be eligible for rendering because coarse bucketing can leave the UI looking
  // stuck near object edges. This still benefits from selector equality because
  // only the specific subscribed field can trigger its consumer.
  if (value == null || !Number.isFinite(Number(value))) return value ?? null;
  return Number(value);
}

export function batteryTelemetryEqual(left, right) {
  return shallowObjectEqual(left, right);
}

export function dockTelemetryEqual(left, right) {
  return shallowObjectEqual(left, right);
}

export function hostStatsEqual(left, right) {
  return shallowObjectEqual(left, right);
}

export function selectLightBumpTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return [];
  return [
    sensorNumber(sensors.lightBumpLeftSignal),
    sensorNumber(sensors.lightBumpFrontLeftSignal),
    sensorNumber(sensors.lightBumpCenterLeftSignal),
    sensorNumber(sensors.lightBumpCenterRightSignal),
    sensorNumber(sensors.lightBumpFrontRightSignal),
    sensorNumber(sensors.lightBumpRightSignal),
  ];
}

export function lightBumpTelemetryEqual(left, right) {
  return shallowArrayEqual(left, right);
}

// Battery bars and warnings follow rover state even without electrical sensors.
export function selectBatteryState(frame) {
  const battery = frame?.roverState?.battery;
  return {
    percentDisplay: battery?.percent ?? null,
    warnActive: battery?.low === true,
    urgentActive: battery?.critical === true,
  };
}

export function selectBatteryTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_BATTERY_TELEMETRY;
  return {
    batteryChargeMah: sensors.batteryChargeMah ?? null,
    batteryCapacityMah: sensors.batteryCapacityMah ?? null,
    batteryVoltage: Number.isFinite(sensors.voltageMv) ? (sensors.voltageMv / 1000).toPrecision(4) : null,
    batteryCurrent: (sensors.currentMa) ?? null,
  };
}

export function selectOvercurrentFlags(frame) {
  const wheelOvercurrents = frame?.sensors?.wheelOvercurrents;
  if (!wheelOvercurrents) return EMPTY_OVERCURRENT_FLAGS;
  return {
    leftWheel: Boolean(wheelOvercurrents.leftWheel),
    rightWheel: Boolean(wheelOvercurrents.rightWheel),
    mainBrush: Boolean(wheelOvercurrents.mainBrush),
    sideBrush: Boolean(wheelOvercurrents.sideBrush),
  };
}

export function selectMainBrushAudioTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_MAIN_BRUSH_AUDIO;
  return {
    mainBrushCurrentMa: bucketNumber(sensors.mainBrushCurrentMa ?? 0, 25),
    mainBrushOvercurrent: Boolean(sensors.wheelOvercurrents?.mainBrush),
  };
}

export function mainBrushAudioTelemetryEqual(left, right) {
  return shallowObjectEqual(left, right);
}

export function overcurrentFlagsEqual(left, right) {
  return shallowObjectEqual(left, right);
}

export function selectDockTelemetry(frame) {
  const state = frame?.roverState;
  const docking = frame?.docking;
  return {
    drivingMode: state?.drivingMode ?? null,
    autoDocking: state?.docking ?? null,
    dockingPhase: docking?.phase || (state?.docked ? state.battery?.charging ? 'charging' : 'docked' : 'idle'),
    movementLocked: docking?.movementLocked ?? state?.drivingMode !== true,
    cameraLocked: state?.dockAssist === true,
    dockingError: docking?.error?.message || '',
    oiModeLabel: state?.drivingMode === true ? 'Driving' : state?.drivingMode === false ? 'Not driving' : 'Unknown',
    chargingStateLabel: state?.battery?.charging === true ? 'Charging' : state?.battery?.charging === false ? 'Not charging' : 'Unknown',
    homeBase: state?.docked ?? null,
  };
}

export function selectSpectatorTelemetry(frame) {
  const sensors = frame?.sensors || {};
  return {
    voltageMv: bucketNumber(sensors.voltageMv, 25),
    currentMa: bucketNumber(sensors.currentMa, 25),
    batteryChargeMah: sensors.batteryChargeMah ?? null,
    batteryCapacityMah: sensors.batteryCapacityMah ?? null,
    drivingMode: frame?.roverState?.drivingMode ?? null,
    charging: frame?.roverState?.battery?.charging ?? null,
    homeBase: frame?.roverState?.docked ?? null,
  };
}

export function spectatorTelemetryEqual(left, right) {
  return shallowObjectEqual(left, right);
}

export function selectHostStats(frame) {
  return frame?.hostStats || EMPTY_HOST_STATS;
}

export function selectFrameForDisplay(frame) {
  return frame || null;
}
