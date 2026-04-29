// rover Manager math utils
// Purpose: Centralizes numeric clamping and battery display calculations used by rover-manager orchestration.
// Scope: Keeps runtime behavior unchanged by extracting pure utility functions from the main service module.
const { DEFAULT_PRIVATE_SAFETY } = require('./constants');

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizePrivateSafety(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    speedLimitEnabled: Boolean(source.speedLimitEnabled),
    speedLimitMaxWheelSpeed: clampInt(
      source.speedLimitMaxWheelSpeed,
      1,
      500,
      DEFAULT_PRIVATE_SAFETY.speedLimitMaxWheelSpeed,
    ),
    hardOvercurrentEnabled: Boolean(source.hardOvercurrentEnabled),
    overcurrentStopMs: clampInt(
      source.overcurrentStopMs,
      100,
      5000,
      DEFAULT_PRIVATE_SAFETY.overcurrentStopMs,
    ),
    hardBumpEnabled: Boolean(source.hardBumpEnabled),
    bumpBackoffSpeed: clampInt(
      source.bumpBackoffSpeed,
      1,
      500,
      DEFAULT_PRIVATE_SAFETY.bumpBackoffSpeed,
    ),
    bumpBackoffMs: clampInt(
      source.bumpBackoffMs,
      100,
      5000,
      DEFAULT_PRIVATE_SAFETY.bumpBackoffMs,
    ),
    cliffEnabled: Boolean(source.cliffEnabled),
    cliffBackoffSpeed: clampInt(
      source.cliffBackoffSpeed,
      1,
      500,
      DEFAULT_PRIVATE_SAFETY.cliffBackoffSpeed,
    ),
    cliffBackoffMs: clampInt(
      source.cliffBackoffMs,
      100,
      5000,
      DEFAULT_PRIVATE_SAFETY.cliffBackoffMs,
    ),
    triggerCooldownMs: clampInt(
      source.triggerCooldownMs,
      100,
      10000,
      DEFAULT_PRIVATE_SAFETY.triggerCooldownMs,
    ),
  };
}

function computeBatteryDisplayPercent({ charge, full, warn, urgent, percent, capacity }) {
  if (
    charge != null &&
    full != null &&
    warn != null &&
    urgent != null &&
    full > warn &&
    warn > urgent
  ) {
    if (charge <= urgent) return 0;
    if (charge <= warn) {
      const t = (charge - urgent) / (warn - urgent);
      return Math.round(Math.max(0, Math.min(1, t)) * 10);
    }
    if (charge >= full) return 100;
    const t = (charge - warn) / (full - warn);
    return Math.round((0.1 + Math.max(0, Math.min(1, t)) * 0.9) * 100);
  }
  if (percent != null && Number.isFinite(percent)) {
    return Math.round(Math.max(0, Math.min(1, percent)) * 100);
  }
  if (charge != null && capacity != null && capacity > 0) {
    const fallback = charge / capacity;
    return Math.round(Math.max(0, Math.min(1, fallback)) * 100);
  }
  return null;
}

function computeBatteryState(record, sensors) {
  if (!record) return null;
  if (!sensors) return record.batteryState;
  const config = record.meta?.battery || null;
  const charge = sensors?.batteryChargeMah ?? null;
  const capacity = sensors?.batteryCapacityMah ?? null;
  const full = typeof config?.Full === 'number' ? config.Full : null;
  const warn = typeof config?.Warn === 'number' ? config.Warn : null;
  const urgent = typeof config?.Urgent === 'number' ? config.Urgent : null;
  let percent = null;
  if (charge != null && warn != null && full != null && full > warn) {
    const span = full - warn;
    percent = (charge - warn) / span;
  } else if (charge != null && capacity != null && capacity > 0) {
    percent = charge / capacity;
  }
  if (percent != null) {
    percent = Math.max(0, Math.min(1, percent));
  }
  const percentDisplay = computeBatteryDisplayPercent({
    charge,
    full,
    warn,
    urgent,
    percent,
    capacity,
  });
  return {
    charge,
    capacity,
    full,
    warn,
    urgent,
    percent,
    percentDisplay,
    warnActive: Boolean(warn != null && charge != null && charge <= warn),
    urgentActive: Boolean(urgent != null && charge != null && charge <= urgent),
    updatedAt: Date.now(),
  };
}

module.exports = {
  clampInt,
  normalizePrivateSafety,
  computeBatteryDisplayPercent,
  computeBatteryState,
};
