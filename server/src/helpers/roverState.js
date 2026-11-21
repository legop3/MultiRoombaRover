const flags = ['drivingMode', 'docking', 'docked', 'headlightOn', 'laserOn'];
const batteryFlags = ['charging', 'low', 'critical', 'needsCharge'];
function validState(state) {
  if (!state || Array.isArray(state) || typeof state !== 'object') return false;
  const battery = state.battery;
  const flag = (obj, key) => Object.hasOwn(obj, key) && (obj[key] === null || typeof obj[key] === 'boolean');
  return flags.every(key => flag(state, key)) && battery && !Array.isArray(battery)
    && batteryFlags.every(key => flag(battery, key)) && Object.hasOwn(battery, 'percent')
    && (battery.percent === null || (Number.isFinite(battery.percent) && battery.percent >= 0 && battery.percent <= 100));
}
// Presentation projection only. No server inference from electrical telemetry.
function batteryView(state) {
  const b = state?.battery;
  return b ? { percentDisplay: b.percent, percent: b.percent == null ? null : b.percent/100,
    warnActive: b.low, urgentActive: b.critical, needsCharge: b.needsCharge } : null;
}
module.exports = { validState, batteryView };
