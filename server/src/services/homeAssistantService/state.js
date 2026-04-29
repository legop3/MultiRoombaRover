// Home Assistant Runtime State
// Purpose: Stores shared mutable runtime state and constants for Home Assistant integration.
// Scope: Centralizes event emitters, entity caches, trigger runtime, and connection/light policy flags.
const EventEmitter = require('events');

const events = new EventEmitter();
const entityConfig = new Map();
const entityState = new Map();
const triggerConfig = [];
const triggerRuntime = new Map();

const HA_BUTTON_EVENT_TYPE = 'ha.button.action';
const LIGHT_IDLE_OFF_MS = 2 * 60 * 1000;
const DEFAULT_WHITE_KELVIN = 4000;
const NIGHT_VISION_DISABLE_ACTION = 'on';

const runtime = {
  latestEntitySnapshot: {},
  connection: null,
  unsubscribeEntities: null,
  reconnectTimer: null,
  connected: false,
  lightsLockState: null,
  lightsIdleOffTimer: null,
  lightsIdleOffDeadline: null,
};

module.exports = {
  events,
  entityConfig,
  entityState,
  triggerConfig,
  triggerRuntime,
  HA_BUTTON_EVENT_TYPE,
  LIGHT_IDLE_OFF_MS,
  DEFAULT_WHITE_KELVIN,
  NIGHT_VISION_DISABLE_ACTION,
  runtime,
};
