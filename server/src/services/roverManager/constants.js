// rover Manager constants
// Purpose: Defines rover-manager configuration constants and immutable default safety values.
// Scope: Keeps runtime behavior unchanged while isolating fixed thresholds and timing knobs.
const ALERT_COLOR = '#8bc34a';
const DOCK_GUARD_WINDOW_MS = 2 * 1000;
const IDLE_UNDOCKED_MS = 2 * 60 * 1000;
const PASSIVE_UNDOCKED_MS = 60 * 1000;
const DOCK_GUARD_RETRY_MS = 10 * 1000;
const DOCK_COMMAND_BASE64 = Buffer.from([143]).toString('base64');
const BACKOFF_MS = 500;
const BACKOFF_SPEED = 300;
const PRIVATE_BUTTON_HOLD_MS = 3000;
const PRIVATE_AUTO_CLOSE_IDLE_MS = 30 * 60 * 1000;
const PRIVATE_AUTO_CLOSE_TICK_MS = 30000;
const SAFETY_BACKOFF_MIN = -500;
const SAFETY_BACKOFF_MAX = 500;

const DEFAULT_PRIVATE_SAFETY = Object.freeze({
  speedLimitEnabled: false,
  speedLimitMaxWheelSpeed: 250,
  hardOvercurrentEnabled: false,
  overcurrentStopMs: 300,
  hardBumpEnabled: false,
  bumpBackoffSpeed: 250,
  bumpBackoffMs: 350,
  cliffEnabled: false,
  cliffBackoffSpeed: 250,
  cliffBackoffMs: 500,
  triggerCooldownMs: 800,
});

module.exports = {
  ALERT_COLOR,
  DOCK_GUARD_WINDOW_MS,
  IDLE_UNDOCKED_MS,
  PASSIVE_UNDOCKED_MS,
  DOCK_GUARD_RETRY_MS,
  DOCK_COMMAND_BASE64,
  BACKOFF_MS,
  BACKOFF_SPEED,
  PRIVATE_BUTTON_HOLD_MS,
  PRIVATE_AUTO_CLOSE_IDLE_MS,
  PRIVATE_AUTO_CLOSE_TICK_MS,
  SAFETY_BACKOFF_MIN,
  SAFETY_BACKOFF_MAX,
  DEFAULT_PRIVATE_SAFETY,
};
