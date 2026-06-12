// Telemetry Views
// Purpose: Defines small, stable telemetry projections for UI components.
// Scope: Keeps rendering subscriptions focused on the sensor fields each view actually uses.

import { shallowArrayEqual, shallowObjectEqual } from './TelemetryContext.jsx';

export const EMPTY_MAP_TELEMETRY = Object.freeze({
  bumpLeft: false,
  bumpRight: false,
  wheelDropLeft: false,
  wheelDropRight: false,
  leftWheelOvercurrent: false,
  rightWheelOvercurrent: false,
  sideBrushOvercurrent: false,
  mainBrushOvercurrent: false,
  wheelLeftCurrentMa: 0,
  wheelRightCurrentMa: 0,
  sideBrushCurrentMa: 0,
  mainBrushCurrentMa: 0,
  lightBumpLeftSignal: null,
  lightBumpFrontLeftSignal: null,
  lightBumpCenterLeftSignal: null,
  lightBumpCenterRightSignal: null,
  lightBumpFrontRightSignal: null,
  lightBumpRightSignal: null,
  cliffLeftSignal: null,
  cliffFrontLeftSignal: null,
  cliffFrontRightSignal: null,
  cliffRightSignal: null,
  cliffLeft: false,
  cliffFrontLeft: false,
  cliffFrontRight: false,
  cliffRight: false,
  dirtDetectLeft: null,
  dirtDetect: null,
});

const EMPTY_BATTERY_TELEMETRY = Object.freeze({
  batteryChargeMah: null,
  batteryCapacityMah: null,
});

const EMPTY_DOCK_TELEMETRY = Object.freeze({
  oiModeLabel: 'Unknown',
  chargingStateLabel: '',
  homeBase: false,
});

const EMPTY_SPECTATOR_TELEMETRY = Object.freeze({
  voltageMv: null,
  currentMa: null,
  batteryChargeMah: null,
  oiModeLabel: 'Unknown',
  chargingStateLabel: '',
  homeBase: false,
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

export function mapTelemetryEqual(left, right) {
  return shallowObjectEqual(left, right);
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

export function selectVisualMapTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_MAP_TELEMETRY;
  const bumps = sensors.bumpsAndWheelDrops || {};
  const wheelOver = sensors.wheelOvercurrents || {};
  return {
    bumpLeft: Boolean(bumps.bumpLeft),
    bumpRight: Boolean(bumps.bumpRight),
    wheelDropLeft: Boolean(bumps.wheelDropLeft),
    wheelDropRight: Boolean(bumps.wheelDropRight),
    leftWheelOvercurrent: Boolean(wheelOver.leftWheel),
    rightWheelOvercurrent: Boolean(wheelOver.rightWheel),
    sideBrushOvercurrent: Boolean(wheelOver.sideBrush),
    mainBrushOvercurrent: Boolean(wheelOver.mainBrush),
    wheelLeftCurrentMa: bucketNumber(sensors.wheelLeftCurrentMa ?? 0, 5),
    wheelRightCurrentMa: bucketNumber(sensors.wheelRightCurrentMa ?? 0, 5),
    sideBrushCurrentMa: bucketNumber(sensors.sideBrushCurrentMa ?? 0, 5),
    mainBrushCurrentMa: bucketNumber(sensors.mainBrushCurrentMa ?? 0, 5),
    lightBumpLeftSignal: sensorNumber(sensors.lightBumpLeftSignal),
    lightBumpFrontLeftSignal: sensorNumber(sensors.lightBumpFrontLeftSignal),
    lightBumpCenterLeftSignal: sensorNumber(sensors.lightBumpCenterLeftSignal),
    lightBumpCenterRightSignal: sensorNumber(sensors.lightBumpCenterRightSignal),
    lightBumpFrontRightSignal: sensorNumber(sensors.lightBumpFrontRightSignal),
    lightBumpRightSignal: sensorNumber(sensors.lightBumpRightSignal),
    cliffLeftSignal: bucketNumber(sensors.cliffLeftSignal, 5),
    cliffFrontLeftSignal: bucketNumber(sensors.cliffFrontLeftSignal, 5),
    cliffFrontRightSignal: bucketNumber(sensors.cliffFrontRightSignal, 5),
    cliffRightSignal: bucketNumber(sensors.cliffRightSignal, 5),
    cliffLeft: Boolean(sensors.cliffLeft),
    cliffFrontLeft: Boolean(sensors.cliffFrontLeft),
    cliffFrontRight: Boolean(sensors.cliffFrontRight),
    cliffRight: Boolean(sensors.cliffRight),
    dirtDetectLeft: bucketNumber(sensors.dirtDetectLeft, 1),
    dirtDetect: bucketNumber(sensors.dirtDetect, 1),
  };
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

export function selectBatteryTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_BATTERY_TELEMETRY;
  return {
    batteryChargeMah: sensors.batteryChargeMah ?? null,
    batteryCapacityMah: sensors.batteryCapacityMah ?? null,
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
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_DOCK_TELEMETRY;
  return {
    oiModeLabel: sensors.oiMode?.label || 'Unknown',
    chargingStateLabel: sensors.chargingState?.label || '',
    homeBase: Boolean(sensors.chargingSources?.homeBase),
  };
}

export function selectSpectatorTelemetry(frame) {
  const sensors = frame?.sensors;
  if (!sensors) return EMPTY_SPECTATOR_TELEMETRY;
  return {
    voltageMv: bucketNumber(sensors.voltageMv, 25),
    currentMa: bucketNumber(sensors.currentMa, 25),
    batteryChargeMah: sensors.batteryChargeMah ?? null,
    oiModeLabel: sensors.oiMode?.label || 'Unknown',
    chargingStateLabel: sensors.chargingState?.label || '',
    homeBase: Boolean(sensors.chargingSources?.homeBase),
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
