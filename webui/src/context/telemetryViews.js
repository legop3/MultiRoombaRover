// Telemetry Views
// Purpose: Defines small, stable telemetry projections for UI components.
// Scope: Keeps rendering subscriptions focused on the sensor fields each view actually uses.

import { shallowArrayEqual, shallowObjectEqual } from './TelemetryContext.jsx';

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

export function batteryTelemetryEqual(left, right) {
  return shallowObjectEqual(left, right);
}

export function dockTelemetryEqual(left, right) {
  return shallowObjectEqual(left, right);
}

/*
  Host stats are compared by value, not shallowly.

  Unlike the sensor selectors above, this one hands back roverd's payload as-is, and that
  payload nests: `wifi` and `errors` one level down, `media.video.active` three. It arrives
  freshly parsed from JSON every second, so every nested value is a new reference every tick.
  A shallow compare therefore reported "changed" on every single frame regardless of content -
  the memoisation was present but never once held, and the card re-rendered at 1Hz forever.

  The recursion is depth-limited rather than unbounded. This runs on a 1Hz hot path against a
  payload whose shape is defined by roverd's HostStats struct, so a cycle is not reachable
  today; the limit is there so that if the payload ever grows deeper or gains a cycle, this
  degrades to "treat as different" - one wasted render - instead of blowing the stack.
*/
const HOST_STATS_MAX_COMPARE_DEPTH = 4;

function hostStatsValueEqual(left, right, depth) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (depth >= HOST_STATS_MAX_COMPARE_DEPTH) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!hostStatsValueEqual(left[key], right[key], depth + 1)) return false;
  }
  return true;
}

export function hostStatsEqual(left, right) {
  return hostStatsValueEqual(left, right, 0);
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
