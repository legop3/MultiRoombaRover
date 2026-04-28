// constants
// Purpose: Defines the constants module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const ALERT_COLOR = '#ff5722';
const TURN_DURATION_MS = 60 * 1000;
const IDLE_TIMEOUT_MS = 7 * 1000;
const MAX_IDLE_SKIPS = 3;
const STALE_REAPER_MS = 5000;

module.exports = {
  ALERT_COLOR,
  TURN_DURATION_MS,
  IDLE_TIMEOUT_MS,
  MAX_IDLE_SKIPS,
  STALE_REAPER_MS,
};
