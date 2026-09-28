// Match actuator configuration, not a rover's display name or changing telemetry.
const { isDeepStrictEqual } = require('node:util');

function controlProfile(meta = {}) {
  return Object.fromEntries(['cameraServo', 'peripherals', 'headlight', 'laser', 'roomba', 'platform']
    .map((key) => [key, meta?.[key] ?? null]));
}

function compatible(model, record) {
  if (model?.specification?.version !== 1 || !record) return false;
  const profile = controlProfile(record.meta);
  return Array.isArray(model.controlProfiles) && model.controlProfiles.some((saved) => isDeepStrictEqual(saved, profile));
}

module.exports = { controlProfile, compatible };
