// home Assistant Service
// Purpose: Defines the home Assistant Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const EventEmitter = require('events');
const WebSocket = require('ws');
const { createConnection, subscribeEntities, callService, Auth } = require('home-assistant-js-websocket');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('homeAssistantService');
const { loadConfig } = require('../../helpers/configLoader');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { isAdmin, isLockdownAdmin } = require('../roleService');
const roverManager = require('../roverManager');
const { issueCommand } = require('../commandService');
const { publishEvent } = require('../eventBus');
const { getActiveDrivers, turnEvents } = require('../turnService');

// home-assistant-js-websocket expects a global WebSocket in Node.
if (!global.WebSocket) {
  global.WebSocket = WebSocket;
}

const config = loadConfig();
const haConfig = config.homeAssistant || {};

const events = new EventEmitter();
const entityConfig = new Map(); // entityId -> { id, name, type }
const entityState = new Map(); // entityId -> normalized state
const triggerConfig = []; // [{ runtimeKey, entityId, action, stateEquals, payload, cooldownMs, allowedModes }]
const triggerRuntime = new Map(); // triggerId -> { lastFiredAt, lastState, lastChanged, lastUpdated }
const HA_BUTTON_EVENT_TYPE = 'ha.button.action';
const LIGHT_IDLE_OFF_MS = 2 * 60 * 1000;
const DEFAULT_WHITE_KELVIN = 4000;
let latestEntitySnapshot = {};
// Rover daemon uses inverted semantics: action "on" powers IR LEDs, which means nightVisionOn=false.
const NIGHT_VISION_DISABLE_ACTION = 'on';

let connection = null;
let unsubscribeEntities = null;
let reconnectTimer = null;
let connected = false;
let lightsLockState = null; // null | 'on' | 'off'
let lightsIdleOffTimer = null;
let lightsIdleOffDeadline = null;

const enabled = Boolean(haConfig?.url && haConfig?.token);

function buildAuth() {
  const token = haConfig?.token?.trim();
  const url = haConfig?.url?.trim();
  if (!token || !url) {
    throw new Error('Home Assistant url/token missing');
  }
  // Long-lived tokens last 10 years; set a far future expiry to avoid refresh attempts.
  return new Auth(
    {
      hassUrl: url.replace(/\/+$/, ''),
      access_token: token,
      expires: Date.now() + 1000 * 60 * 60 * 24 * 365 * 10,
      refresh_token: null,
      clientId: 'multiroomba-rover',
    },
    null,
  );
}

function inferType(entityId, explicitType) {
  if (explicitType === 'light' || explicitType === 'switch') {
    return explicitType;
  }
  const domain = String(entityId || '').split('.')[0];
  if (domain === 'light') return 'light';
  return 'switch';
}

function normalizeConfigEntry(entry) {
  if (!entry) return null;
  const id = entry.id || entry.entityId || entry.entity_id;
  if (!id) return null;
  const type = inferType(id, entry.type);
  const name = entry.name || null;
  return { id: String(id), name, type };
}

function loadEntityConfig() {
  entityConfig.clear();
  const list = Array.isArray(haConfig?.entities) ? haConfig.entities : [];
  list.forEach((entry) => {
    const normalized = normalizeConfigEntry(entry);
    if (normalized) {
      entityConfig.set(normalized.id, normalized);
      if (!entityState.has(normalized.id)) {
        entityState.set(normalized.id, buildState(normalized, null));
      }
    }
  });
  logger.info('Loaded Home Assistant entities', { count: entityConfig.size });
}

function normalizeTriggerEntry(entry, index) {
  if (!entry || typeof entry !== 'object') return null;
  const action = String(entry.action || '').trim();
  if (!action) return null;
  const entityId = String(entry.entityId || entry.entity_id || '').trim();
  if (!entityId) return null;
  const stateEqualsRaw = entry.stateEquals ?? entry.state_equals;
  const stateEquals =
    stateEqualsRaw === null || stateEqualsRaw === undefined ? null : String(stateEqualsRaw).trim();
  const runtimeKey = `${action}::entity::${entityId}::${stateEquals || '*'}::${index}`;
  const cooldownMs = Number.isFinite(Number(entry.cooldownMs)) ? Math.max(0, Number(entry.cooldownMs)) : 0;
  const allowedModes = Array.isArray(entry.allowedModes)
    ? entry.allowedModes.map((mode) => String(mode || '').trim().toLowerCase()).filter(Boolean)
    : null;
  return {
    runtimeKey,
    entityId,
    action,
    stateEquals,
    payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {},
    cooldownMs,
    allowedModes,
  };
}

function loadTriggerConfig() {
  triggerConfig.length = 0;
  const list = Array.isArray(haConfig?.buttons) ? haConfig.buttons : [];
  list.forEach((entry, index) => {
    const normalized = normalizeTriggerEntry(entry, index);
    if (!normalized) return;
    triggerConfig.push(normalized);
    if (!triggerRuntime.has(normalized.runtimeKey)) {
      triggerRuntime.set(normalized.runtimeKey, {
        lastFiredAt: 0,
        lastState: null,
        lastChanged: null,
        lastUpdated: null,
      });
    }
  });
  logger.info('Loaded Home Assistant buttons', { count: triggerConfig.length });
}

function buildState(meta, raw) {
  if (!meta) return null;
  const name = meta.name || raw?.attributes?.friendly_name || meta.id;
  const supportedColorModes = Array.isArray(raw?.attributes?.supported_color_modes)
    ? raw.attributes.supported_color_modes.map((mode) => String(mode))
    : [];
  const rgbColor = Array.isArray(raw?.attributes?.rgb_color) ? raw.attributes.rgb_color : null;
  const hsColor = Array.isArray(raw?.attributes?.hs_color) ? raw.attributes.hs_color : null;
  const supportsColor =
    meta.type === 'light' &&
    (rgbColor ||
      hsColor ||
      supportedColorModes.some((mode) => mode === 'hs' || mode === 'rgb' || mode === 'xy'));
  if (!raw) {
    return {
      id: meta.id,
      name,
      type: meta.type,
      state: 'unknown',
      available: false,
      lastChanged: null,
      lastUpdated: null,
      supportedColorModes,
      colorMode: null,
      rgbColor: null,
      hsColor: null,
      supportsColor,
    };
  }
  const rawState = raw.state;
  const unavailable = rawState === 'unavailable' || rawState === 'unknown';
  const state = unavailable ? 'unavailable' : rawState === 'on' ? 'on' : 'off';
  return {
    id: meta.id,
    name,
    type: meta.type,
    state,
    available: !unavailable,
    lastChanged: raw.last_changed || null,
    lastUpdated: raw.last_updated || null,
    supportedColorModes,
    colorMode: raw?.attributes?.color_mode || null,
    rgbColor,
    hsColor,
    supportsColor,
  };
}

function emitUpdate() {
  events.emit('update', getState());
}

function emitStatus() {
  events.emit('status', getState());
}

function getControllableEntityIds() {
  return Array.from(entityConfig.values()).map((meta) => String(meta.id));
}

function turnOffAllRoverNightVision() {
  const records = Array.from(roverManager.rovers.values());
  let attempted = 0;
  let failed = 0;
  const roverIds = [];
  records.forEach((record) => {
    if (!record?.ws) return;
    roverIds.push(String(record.id));
    attempted += 1;
    try {
      issueCommand(record.id, {
        type: 'nightVision',
        nightVision: { action: NIGHT_VISION_DISABLE_ACTION },
      });
    } catch (err) {
      failed += 1;
      logger.warn('Failed to auto turn off rover night vision after idle', {
        roverId: record.id,
        error: err.message,
      });
    }
  });
  return { attempted, failed, roverIds };
}

function getActiveDriverCount() {
  const active = getActiveDrivers();
  const turnCount = active && typeof active === 'object' ? Object.keys(active).length : 0;
  if (turnCount > 0) return turnCount;
  // Fallback: trust live rover driver sets if turn-service tracking is temporarily out of sync.
  let liveCount = 0;
  roverManager.rovers.forEach((record) => {
    if (record?.drivers?.size > 0) {
      liveCount += 1;
    }
  });
  return liveCount;
}

function hasActiveDrivers() {
  return getActiveDriverCount() > 0;
}

function clearLightsIdleOffTimer() {
  if (lightsIdleOffTimer) {
    clearTimeout(lightsIdleOffTimer);
    lightsIdleOffTimer = null;
  }
  if (lightsIdleOffDeadline != null) {
    lightsIdleOffDeadline = null;
    emitUpdate();
  }
}

function scheduleLightsIdleOffTimer() {
  if (!enabled) return;
  if (getControllableEntityIds().length === 0) return;
  if (lightsIdleOffTimer || lightsLockState != null || hasActiveDrivers()) {
    return;
  }
  lightsIdleOffDeadline = Date.now() + LIGHT_IDLE_OFF_MS;
  lightsIdleOffTimer = setTimeout(async () => {
    lightsIdleOffTimer = null;
    lightsIdleOffDeadline = null;
    try {
      await setAllControllableEntitiesState('off');
      const nightVisionResult = turnOffAllRoverNightVision();
      logger.info('Auto-turned off room lights due to no active drivers', {
        idleMs: LIGHT_IDLE_OFF_MS,
        nightVisionRovers: nightVisionResult.attempted,
        nightVisionFailures: nightVisionResult.failed,
        nightVisionRoverIds: nightVisionResult.roverIds,
      });
    } catch (err) {
      logger.warn('Failed auto light-off after idle', err.message);
    } finally {
      emitUpdate();
      evaluateLightAutomation();
    }
  }, LIGHT_IDLE_OFF_MS);
  emitUpdate();
}

function evaluateLightAutomation() {
  if (lightsLockState != null) {
    clearLightsIdleOffTimer();
    return;
  }
  if (hasActiveDrivers()) {
    clearLightsIdleOffTimer();
    return;
  }
  scheduleLightsIdleOffTimer();
}

function handleEntitySnapshot(snapshot = {}) {
  latestEntitySnapshot = snapshot || {};
  events.emit('snapshot', latestEntitySnapshot);
  let changed = false;
  entityConfig.forEach((meta, id) => {
    const raw = snapshot[id];
    const next = buildState(meta, raw);
    const prev = entityState.get(id);
    if (
      !prev ||
      prev.state !== next.state ||
      prev.available !== next.available ||
      prev.lastChanged !== next.lastChanged
    ) {
      entityState.set(id, next);
      changed = true;
    }
  });
  if (changed) {
    emitUpdate();
  }
  evaluateTriggers(snapshot);
}

function triggerMatches(trigger, raw, runtimeState) {
  if (!raw) return false;
  const nextState = raw?.state ?? null;
  const nextChanged = raw?.last_changed ?? null;
  const nextUpdated = raw?.last_updated ?? null;
  const changed =
    runtimeState.lastState !== nextState ||
    runtimeState.lastChanged !== nextChanged ||
    runtimeState.lastUpdated !== nextUpdated;
  if (!changed) {
    return { matched: false, nextState, nextChanged, nextUpdated };
  }
  if (trigger.stateEquals != null && String(trigger.stateEquals) !== String(nextState)) {
    return { matched: false, nextState, nextChanged, nextUpdated };
  }
  return { matched: true, nextState, nextChanged, nextUpdated };
}

function dispatchButtonAction(trigger, runtimeState, payload = {}) {
  const now = Date.now();
  const mode = String(getMode() || '').toLowerCase();
  if (trigger.allowedModes?.length && !trigger.allowedModes.includes(mode)) return;
  if (trigger.cooldownMs > 0 && now - runtimeState.lastFiredAt < trigger.cooldownMs) return;
  runtimeState.lastFiredAt = now;
  triggerRuntime.set(trigger.runtimeKey, runtimeState);
  const basePayload = {
    buttonId: trigger.action,
    action: trigger.action,
    firedAt: now,
    ...(payload || {}),
    ...(trigger.payload || {}),
  };
  logger.info('Home Assistant button action fired', {
    action: trigger.action,
    source: 'entity',
    entityId: payload?.entityId || null,
  });
  events.emit('trigger', basePayload);
  publishEvent({
    source: 'homeAssistant',
    type: HA_BUTTON_EVENT_TYPE,
    payload: basePayload,
  });
}

function evaluateTriggers(snapshot = {}) {
  if (!triggerConfig.length) return;
  triggerConfig.forEach((trigger) => {
    const runtimeState = triggerRuntime.get(trigger.runtimeKey) || {
      lastFiredAt: 0,
      lastState: null,
      lastChanged: null,
      lastUpdated: null,
    };
    const raw = snapshot?.[trigger.entityId] || null;
    const evalResult = triggerMatches(trigger, raw, runtimeState);
    runtimeState.lastState = evalResult.nextState;
    runtimeState.lastChanged = evalResult.nextChanged;
    runtimeState.lastUpdated = evalResult.nextUpdated;
    triggerRuntime.set(trigger.runtimeKey, runtimeState);
    if (!evalResult.matched) return;
    dispatchButtonAction(trigger, runtimeState, {
      entityId: trigger.entityId,
      state: raw?.state ?? null,
      attributes: raw?.attributes || {},
      lastChanged: raw?.last_changed || null,
      lastUpdated: raw?.last_updated || null,
    });
  });
}

function teardownConnection() {
  if (unsubscribeEntities) {
    try {
      unsubscribeEntities();
    } catch (err) {
      logger.warn('Failed to unsubscribe entity stream', err.message);
    }
  }
  unsubscribeEntities = null;
  if (connection) {
    try {
      connection.close();
    } catch (err) {
      logger.warn('Error closing Home Assistant connection', err.message);
    }
  }
  connection = null;
  const wasConnected = connected;
  connected = false;
  if (wasConnected) {
    emitStatus();
  }
}

function scheduleReconnect(delayMs = 5000) {
  if (!enabled) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delayMs);
}

async function connect() {
  if (!enabled) {
    logger.info('Home Assistant integration disabled; missing url/token in config');
    return;
  }
  if (connection) {
    return;
  }
  try {
    const auth = buildAuth();
    connection = await createConnection({ auth, setupRetry: 0 });
    connected = true;
    emitStatus();
    logger.info('Connected to Home Assistant');
    unsubscribeEntities = subscribeEntities(connection, handleEntitySnapshot);
    connection.addEventListener('disconnected', () => {
      logger.warn('Home Assistant connection lost');
      teardownConnection();
      scheduleReconnect();
    });
  } catch (err) {
    logger.warn('Home Assistant connection failed', err.message);
    teardownConnection();
    scheduleReconnect();
  }
}

async function setEntityState(entityId, desiredState) {
  if (!enabled) {
    throw new Error('Home Assistant not configured');
  }
  const meta = entityConfig.get(entityId);
  if (!meta) {
    throw new Error('Unknown Home Assistant entity');
  }
  if (!connection) {
    throw new Error('Home Assistant not connected');
  }
  const nextState = desiredState === 'on' ? 'on' : 'off';
  const domain = meta.type === 'light' ? 'light' : 'switch';
  const service = nextState === 'on' ? 'turn_on' : 'turn_off';
  await callHomeAssistantService(domain, service, { entity_id: entityId });
  logger.info('Issued Home Assistant command', { entityId, domain, service });
}

async function setAllControllableEntitiesState(desiredState) {
  const ids = getControllableEntityIds();
  if (!ids.length) return;
  const results = await Promise.allSettled(ids.map((id) => setEntityState(id, desiredState)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) {
    logger.warn('Some Home Assistant entity state updates failed', {
      desiredState,
      total: ids.length,
      failed: failures.length,
    });
  }
}

async function toggleEntity(entityId) {
  const current = entityState.get(entityId);
  const nextState = current?.state === 'on' ? 'off' : 'on';
  return setEntityState(entityId, nextState);
}

async function setLightColor(entityId, rgbColor) {
  if (!enabled) {
    throw new Error('Home Assistant not configured');
  }
  const meta = entityConfig.get(entityId);
  if (!meta || meta.type !== 'light') {
    throw new Error('Home Assistant light required');
  }
  if (!connection) {
    throw new Error('Home Assistant not connected');
  }
  if (!Array.isArray(rgbColor) || rgbColor.length !== 3) {
    throw new Error('rgbColor required');
  }
  const normalized = rgbColor.map((value) => {
    const next = Number(value);
    if (Number.isNaN(next)) return 0;
    return Math.max(0, Math.min(255, Math.round(next)));
  });
  await callHomeAssistantService('light', 'turn_on', { entity_id: entityId, rgb_color: normalized });
  logger.info('Issued Home Assistant color command', { entityId, rgbColor: normalized });
}

async function setLightWhite(entityId, kelvin = DEFAULT_WHITE_KELVIN) {
  if (!enabled) {
    throw new Error('Home Assistant not configured');
  }
  const meta = entityConfig.get(entityId);
  if (!meta || meta.type !== 'light') {
    throw new Error('Home Assistant light required');
  }
  if (!connection) {
    throw new Error('Home Assistant not connected');
  }
  const nextKelvin = Number(kelvin);
  const normalizedKelvin = Number.isFinite(nextKelvin)
    ? Math.max(2000, Math.min(6500, Math.round(nextKelvin)))
    : DEFAULT_WHITE_KELVIN;
  await callHomeAssistantService('light', 'turn_on', {
    entity_id: entityId,
    color_temp_kelvin: normalizedKelvin,
  });
  logger.info('Issued Home Assistant white command', {
    entityId,
    colorTempKelvin: normalizedKelvin,
  });
}

function isLightControlLocked() {
  return lightsLockState != null;
}

function getLightPolicyState() {
  return {
    locked: lightsLockState != null,
    lockState: lightsLockState,
    lockedOn: lightsLockState === 'on',
    idleOffMs: LIGHT_IDLE_OFF_MS,
    idleOffAt: lightsIdleOffDeadline,
    activeDrivers: getActiveDriverCount(),
  };
}

async function setLightsLockedOn(nextValue, options = {}) {
  const next = Boolean(nextValue);
  const targetState = options?.targetState === 'off' ? 'off' : 'on';
  const forceApply = Boolean(options.forceApply);
  const nextLockState = next ? targetState : null;
  const changed = lightsLockState !== nextLockState;
  lightsLockState = nextLockState;
  if (lightsLockState != null) {
    clearLightsIdleOffTimer();
    if (changed || forceApply) {
      if (enabled) {
        await setAllControllableEntitiesState(lightsLockState);
      }
    }
  } else {
    evaluateLightAutomation();
  }
  if (changed) {
    logger.info('Room lights lock state changed', {
      locked: lightsLockState != null,
      lockState: lightsLockState,
      source: options.source || 'unknown',
    });
  }
  emitUpdate();
  return lightsLockState === 'on';
}

async function toggleLightsLockedOn(options = {}) {
  return setLightsLockedOn(lightsLockState == null, options);
}

function getState() {
  const entities = Array.from(entityConfig.values()).map(
    (meta) => entityState.get(meta.id) || buildState(meta, null),
  );
  return {
    enabled,
    connected,
    entities,
    lightPolicy: getLightPolicyState(),
  };
}

function isConnected() {
  return Boolean(connection && connected);
}

function getRawEntitySnapshot(entityId) {
  if (!entityId) return null;
  return latestEntitySnapshot?.[String(entityId)] || null;
}

async function callHomeAssistantService(domain, service, serviceData = {}) {
  if (!enabled) {
    throw new Error('Home Assistant not configured');
  }
  if (!connection) {
    throw new Error('Home Assistant not connected');
  }
  if (!domain || !service) {
    throw new Error('domain and service required');
  }
  await callService(connection, String(domain), String(service), serviceData || {});
}

loadEntityConfig();
loadTriggerConfig();
connect();
evaluateLightAutomation();

turnEvents.on('activeDriver', () => {
  evaluateLightAutomation();
});

turnEvents.on('queue', () => {
  evaluateLightAutomation();
});

modeEvents.on('change', (mode) => {
  if (mode === MODES.ADMIN || mode === MODES.LOCKDOWN) {
    if (isLightControlLocked()) {
      setLightsLockedOn(false, { source: 'modeGateReset' }).catch((err) => {
        logger.warn('Failed to disable lights lock on mode change', err.message);
      });
    } else {
      evaluateLightAutomation();
    }
    return;
  }
  evaluateLightAutomation();
});

io.on('connection', (socket) => {
  socket.on('homeAssistant:toggle', async ({ entityId } = {}, cb = () => {}) => {
    const mode = getMode();
    if (
      (mode === 'admin' && isAdmin(socket) !== true) ||
      (mode === 'lockdown' && isLockdownAdmin(socket) !== true)
    ) {
      return cb({ error: 'Insufficient permissions to control Home Assistant' });
    }
    if (isLightControlLocked()) {
      return cb({ error: 'Room controls are locked' });
    }
    try {
      if (!entityId) throw new Error('entityId required');
      await toggleEntity(entityId);
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('homeAssistant:setState', async ({ entityId, state } = {}, cb = () => {}) => {
    const mode = getMode();
    if (
      (mode === 'admin' && isAdmin(socket) !== true) ||
      (mode === 'lockdown' && isLockdownAdmin(socket) !== true)
    ) {
      return cb({ error: 'Insufficient permissions to control Home Assistant' });
    }
    if (isLightControlLocked()) {
      return cb({ error: 'Room controls are locked' });
    }

    try {
      if (!entityId) throw new Error('entityId required');
      await setEntityState(entityId, state);
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('homeAssistant:lightColor', async ({ entityId, rgbColor } = {}, cb = () => {}) => {
    const mode = getMode();
    if (
      (mode === 'admin' && isAdmin(socket) !== true) ||
      (mode === 'lockdown' && isLockdownAdmin(socket) !== true)
    ) {
      return cb({ error: 'Insufficient permissions to control Home Assistant' });
    }
    if (isLightControlLocked()) {
      return cb({ error: 'Room controls are locked' });
    }

    try {
      if (!entityId) throw new Error('entityId required');
      await setLightColor(entityId, rgbColor);
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('homeAssistant:lightWhite', async ({ entityId } = {}, cb = () => {}) => {
    const mode = getMode();
    if (
      (mode === 'admin' && isAdmin(socket) !== true) ||
      (mode === 'lockdown' && isLockdownAdmin(socket) !== true)
    ) {
      return cb({ error: 'Insufficient permissions to control Home Assistant' });
    }
    if (isLightControlLocked()) {
      return cb({ error: 'Room controls are locked' });
    }

    try {
      if (!entityId) throw new Error('entityId required');
      await setLightWhite(entityId, haConfig?.whiteKelvin);
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

module.exports = {
  getState,
  isConnected,
  enabled,
  getLightPolicyState,
  isLightControlLocked,
  getRawEntitySnapshot,
  callHomeAssistantService,
  toggleEntity,
  setEntityState,
  setLightColor,
  setLightWhite,
  setLightsLockedOn,
  toggleLightsLockedOn,
  homeAssistantEvents: events,
};
