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
    // Unlike most private safety toggles, virtual wall support is meant to be
    // enabled by default for private rovers. The nullish check preserves that
    // default for older rover configs while still allowing lockdown admins to
    // explicitly turn the guard off.
    virtualWallEnabled:
      source.virtualWallEnabled == null
        ? DEFAULT_PRIVATE_SAFETY.virtualWallEnabled
        : Boolean(source.virtualWallEnabled),
    virtualWallBackoffSpeed: clampInt(
      source.virtualWallBackoffSpeed,
      1,
      500,
      DEFAULT_PRIVATE_SAFETY.virtualWallBackoffSpeed,
    ),
    virtualWallBackoffMs: clampInt(
      source.virtualWallBackoffMs,
      100,
      5000,
      DEFAULT_PRIVATE_SAFETY.virtualWallBackoffMs,
    ),
    triggerCooldownMs: clampInt(
      source.triggerCooldownMs,
      100,
      10000,
      DEFAULT_PRIVATE_SAFETY.triggerCooldownMs,
    ),
  };
}

module.exports = {
  clampInt,
  normalizePrivateSafety,
};
