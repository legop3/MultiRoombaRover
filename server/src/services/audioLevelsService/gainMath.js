// audio Levels Gain Math
// Purpose: Holds the pure clamping and ceiling rules shared by every gain layer.
// Scope: No IO, no state; keeps the volume policy independently reviewable and testable.

/*
  The three gain keys are the same on every layer of this feature: the global
  admin gains, the admin-editable VIP boost caps, and each user's personal
  preference. Iterating one list keeps those layers from drifting apart.
*/
const GAIN_KEYS = ['hornGain', 'ttsGain', 'forwardGain'];

// Absolute gain limits accepted anywhere a multiplier is stored.
const MIN_GAIN = 0;
const MAX_GAIN = 4;

function clampGain(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(MIN_GAIN, Math.min(MAX_GAIN, num));
}

function clampFraction(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function normalizeUserGains(raw = {}) {
  const out = {};
  GAIN_KEYS.forEach((key) => {
    out[key] = clampFraction(raw?.[key], 1);
  });
  return out;
}

function normalizeGainSet(raw = {}, fallback = {}) {
  const out = {};
  GAIN_KEYS.forEach((key) => {
    out[key] = clampGain(raw?.[key], clampGain(fallback?.[key], 1));
  });
  return out;
}

/*
  A user without the boost flag can never exceed the global admin gain. The flag
  raises the ceiling to the admin-managed hard cap, and Math.max keeps the flag
  from ever being a downgrade: if an admin runs the global gain higher than the
  boost cap, a boosted user keeps the global ceiling instead of losing volume
  for holding a permission.
*/
function resolveCeilings({ adminLimits = {}, boostCaps = {}, hasBoost = false } = {}) {
  const out = {};
  GAIN_KEYS.forEach((key) => {
    const adminCeiling = clampGain(adminLimits?.[key], 0);
    out[key] = hasBoost ? Math.max(adminCeiling, clampGain(boostCaps?.[key], 0)) : adminCeiling;
  });
  return out;
}

// Personal preferences are fractions of whichever ceiling applies to the user.
function applyCeilings(fractions = {}, ceilings = {}) {
  const out = {};
  GAIN_KEYS.forEach((key) => {
    out[key] = clampGain(clampFraction(fractions?.[key], 1) * clampGain(ceilings?.[key], 0), 0);
  });
  return out;
}

module.exports = {
  GAIN_KEYS,
  MIN_GAIN,
  MAX_GAIN,
  clampGain,
  clampFraction,
  normalizeUserGains,
  normalizeGainSet,
  resolveCeilings,
  applyCeilings,
};
