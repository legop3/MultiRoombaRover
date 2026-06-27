// Idle Service Constants
// Purpose: Defines idle timing and command constants used by idle automation workflows.
// Scope: Centralizes immutable configuration for trigger windows and rover command payloads.
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const HEADLIGHT_DISABLE_ACTION = 'off';
const LASER_DISABLE_ACTION = 'off';
const DOCK_COMMAND_BASE64 = Buffer.from([143]).toString('base64');

module.exports = {
  IDLE_TIMEOUT_MS,
  HEADLIGHT_DISABLE_ACTION,
  LASER_DISABLE_ACTION,
  DOCK_COMMAND_BASE64,
};
