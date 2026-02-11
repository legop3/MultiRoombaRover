export const WARN_DISPLAY_PERCENT = 10;

export function buildBatteryVisual({ batteryState = null, charge = null, config = null }) {
  const percentDisplayFromState =
    batteryState?.percentDisplay != null && Number.isFinite(batteryState.percentDisplay)
      ? Math.round(batteryState.percentDisplay)
      : null;
  const warnActiveFromState = batteryState?.warnActive ?? null;
  const urgentActiveFromState = batteryState?.urgentActive ?? null;

  const full = config?.Full ?? null;
  const warn = config?.Warn ?? null;
  const urgent = config?.Urgent ?? null;
  const chargeValue = charge ?? batteryState?.charge ?? null;

  let percentDisplay = percentDisplayFromState;
  if (percentDisplay == null) {
    percentDisplay = computeDisplayPercent({ charge: chargeValue, full, warn, urgent });
  }
  if (percentDisplay == null) {
    return { available: false };
  }

  const percent = Math.max(0, Math.min(1, percentDisplay / 100));
  const warnActive =
    warnActiveFromState != null
      ? warnActiveFromState
      : Boolean(warn != null && chargeValue != null && chargeValue <= warn);
  const urgentActive =
    urgentActiveFromState != null
      ? urgentActiveFromState
      : Boolean(urgent != null && chargeValue != null && chargeValue <= urgent);

  return {
    available: true,
    percent,
    percentDisplay,
    warnActive,
    urgentActive,
    warnDisplayPercent: WARN_DISPLAY_PERCENT,
  };
}

function computeDisplayPercent({ charge, full, warn, urgent }) {
  if (
    charge != null &&
    full != null &&
    warn != null &&
    urgent != null &&
    full > warn &&
    warn > urgent
  ) {
    const warnOffset = WARN_DISPLAY_PERCENT / 100;
    const upperSpan = 1 - warnOffset;
    if (charge <= urgent) return 0;
    if (charge <= warn) {
      const t = (charge - urgent) / (warn - urgent);
      return Math.round(Math.max(0, Math.min(1, t)) * WARN_DISPLAY_PERCENT);
    }
    if (charge >= full) return 100;
    const t = (charge - warn) / (full - warn);
    return Math.round((warnOffset + Math.max(0, Math.min(1, t)) * upperSpan) * 100);
  }
  return null;
}
