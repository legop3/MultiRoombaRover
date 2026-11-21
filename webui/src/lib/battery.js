// Battery presentation uses only the rover-reported state projection.
export const WARN_DISPLAY_PERCENT = 10;
export function buildBatteryVisual({ batteryState = null }) {
  const value = batteryState?.percentDisplay;
  if (!Number.isFinite(value)) return { available: false };
  return { available: true, percent: value / 100, percentDisplay: Math.round(value),
    warnActive: batteryState.warnActive === true, urgentActive: batteryState.urgentActive === true,
    warnDisplayPercent: WARN_DISPLAY_PERCENT };
}
