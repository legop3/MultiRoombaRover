// Match actuator configuration, not a rover's display name or changing telemetry.
const { isDeepStrictEqual } = require('node:util');
const POLICY_VERSION = 5;

function controlProfile(meta = {}) {
  return Object.fromEntries(['cameraServo', 'headlight', 'roomba', 'platform']
    .map((key) => [key, meta?.[key] ?? null]));
}

function compatible(model, record) {
  if (model?.specification?.version !== POLICY_VERSION || !record) return false;
  const profile = controlProfile(record.meta);
  // Retained recordings may include removed actuator fields. Compare only
  // controls this policy actually uses, on both sides of the boundary.
  return Array.isArray(model.controlProfiles) && model.controlProfiles.some((saved) => isDeepStrictEqual(controlProfile(saved), profile));
}

module.exports = { POLICY_VERSION, controlProfile, compatible };
