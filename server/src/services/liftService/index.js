// Lift Service
// Purpose: Provides a single global lift controller with serialized interlocked motion.
// Scope: Owns lift command sequencing, anti-spam controls, HA wiring, and shared state publication for UI sync.
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('liftService');
const { loadConfig } = require('../../helpers/configLoader');
const { isFeatureEnabled } = require('../../helpers/features');
const { getMode, MODES } = require('../modeManager');
const { isAdmin, isLockdownAdmin } = require('../roleService');
const {
  homeAssistantEvents,
  getRawEntitySnapshot,
  callHomeAssistantService,
  isConnected: isHomeAssistantConnected,
  enabled: homeAssistantEnabled,
} = require('../homeAssistantService');

const events = new EventEmitter();
const config = loadConfig();
const haConfig = config.homeAssistant || {};
const liftConfig = haConfig.lift || {};
const featureEnabled = isFeatureEnabled('lift');

const upSwitchId = String(liftConfig.upSwitch || '').trim();
const downSwitchId = String(liftConfig.downSwitch || '').trim();
const interlockMs = Math.max(250, Number(liftConfig.interlockMs) || 9000);
const commandCooldownMs = Math.max(interlockMs, Number(liftConfig.commandCooldownMs) || 25000);

const state = {
  busy: false,
  target: null,
  lastActionAt: 0,
  lastActor: null,
  lastError: null,
};
let lastEmittedStateJson = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRaw(entityId) {
  if (!entityId) return null;
  return getRawEntitySnapshot(entityId);
}

function readSwitchState(entityId) {
  const raw = readRaw(entityId);
  return String(raw?.state || '').toLowerCase();
}

function hasEntity(entityId) {
  return Boolean(readRaw(entityId));
}

function derivePosition() {
  const up = readSwitchState(upSwitchId);
  const down = readSwitchState(downSwitchId);
  const upOn = up === 'on';
  const downOn = down === 'on';
  if (upOn && !downOn) return 'up';
  if (!upOn && downOn) return 'down';
  if (!upOn && !downOn) return 'stopped';
  return 'conflict';
}

function isConfigured() {
  return Boolean(upSwitchId && downSwitchId);
}

function getState() {
  const configured = isConfigured();
  const connected = isHomeAssistantConnected();
  return {
    enabled: Boolean(featureEnabled && homeAssistantEnabled && configured),
    configured,
    connected,
    entities: {
      upSwitch: upSwitchId,
      downSwitch: downSwitchId,
    },
    availability: {
      upSwitch: hasEntity(upSwitchId),
      downSwitch: hasEntity(downSwitchId),
    },
    interlockMs,
    commandCooldownMs,
    busy: state.busy,
    target: state.target,
    position: derivePosition(),
    lastActionAt: state.lastActionAt || null,
    lastActor: state.lastActor,
    lastError: state.lastError,
  };
}

function emitUpdate() {
  const next = getState();
  const nextJson = JSON.stringify(next);
  if (nextJson === lastEmittedStateJson) return;
  lastEmittedStateJson = nextJson;
  events.emit('update', next);
}

function assertReady() {
  if (!featureEnabled) throw new Error('Lift is disabled');
  if (!isConfigured()) throw new Error('Lift not configured');
  if (!homeAssistantEnabled) throw new Error('Home Assistant not configured');
  if (!isHomeAssistantConnected()) throw new Error('Home Assistant not connected');
}

async function applyPosition(target) {
  async function setSwitch(entityId, desiredState) {
    const service = desiredState === 'on' ? 'turn_on' : 'turn_off';
    await callHomeAssistantService('switch', service, { entity_id: entityId });
  }

  if (target === 'up') {
    await setSwitch(downSwitchId, 'off');
    await sleep(interlockMs);
    await setSwitch(upSwitchId, 'on');
    return;
  }
  await setSwitch(upSwitchId, 'off');
  await sleep(interlockMs);
  await setSwitch(downSwitchId, 'on');
}

async function requestPosition(target, actor = 'unknown') {
  const desired = target === 'up' ? 'up' : 'down';
  assertReady();

  if (state.busy) {
    throw new Error('Lift is busy');
  }

  const now = Date.now();
  const cooldownLeft = commandCooldownMs - (now - state.lastActionAt);
  if (cooldownLeft > 0) {
    throw new Error(`Lift cooldown active (${Math.ceil(cooldownLeft / 100) / 10}s)`);
  }

  const current = derivePosition();
  if (current === desired) {
    return { ok: true, noop: true, target: desired, position: current };
  }

  state.busy = true;
  state.target = desired;
  state.lastError = null;
  state.lastActor = actor;
  emitUpdate();

  try {
    await applyPosition(desired);
    state.lastActionAt = Date.now();
    logger.info('Lift command completed', { target: desired, actor });
    return { ok: true, noop: false, target: desired, position: derivePosition() };
  } catch (err) {
    state.lastError = err.message;
    logger.warn('Lift command failed', { target: desired, actor, error: err.message });
    throw err;
  } finally {
    state.busy = false;
    state.target = null;
    emitUpdate();
  }
}

async function moveUp(actor = 'unknown') {
  return requestPosition('up', actor);
}

async function moveDown(actor = 'unknown') {
  return requestPosition('down', actor);
}

if (featureEnabled) {
  /*
    Lift state depends on Home Assistant switch snapshots. Subscribe only when
    the lift exists so disabled installs do not maintain hardware-specific UI
    sync paths.
  */
  homeAssistantEvents.on('snapshot', emitUpdate);
  homeAssistantEvents.on('status', emitUpdate);

  io.on('connection', (socket) => {
    function assertFeatureAccess() {
      const mode = getMode();
      // Lift is a public activity feature in open and turns modes. Restricted
      // access modes mirror the rest of the server: admin mode admits normal
      // admins, while lockdown admits only the explicitly stronger lockdown
      // role. Enforcing this in the owning service keeps UI buttons and text
      // command behavior aligned instead of trusting individual callers.
      if (mode === MODES.ADMIN && !isAdmin(socket)) throw new Error('Admin mode: admins only');
      if (mode === MODES.LOCKDOWN && !isLockdownAdmin(socket)) throw new Error('Server in lockdown');
    }

    socket.on('lift:up', async (_, cb = () => {}) => {
      try {
        assertFeatureAccess();
        const resp = await moveUp(socket.id || 'socket');
        cb({ success: true, ...resp });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('lift:down', async (_, cb = () => {}) => {
      try {
        assertFeatureAccess();
        const resp = await moveDown(socket.id || 'socket');
        cb({ success: true, ...resp });
      } catch (err) {
        cb({ error: err.message });
      }
    });
  });
} else {
  logger.info('Lift disabled by config');
}

emitUpdate();

module.exports = {
  getState,
  moveUp,
  moveDown,
  liftEvents: events,
};
