const EventEmitter = require('events');
const WebSocket = require('ws');
const { createConnection, subscribeEntities, callService, Auth } = require('home-assistant-js-websocket');
const io = require('../globals/io');
const logger = require('../globals/logger').child('homeAssistantService');
const { loadConfig } = require('../helpers/configLoader');
const { getMode } = require('./modeManager');
const { isAdmin, isLockdownAdmin } = require('./roleService');
const { publishEvent } = require('./eventBus');

// home-assistant-js-websocket expects a global WebSocket in Node.
if (!global.WebSocket) {
  global.WebSocket = WebSocket;
}

const config = loadConfig();
const haConfig = config.homeAssistant || {};

const events = new EventEmitter();
const entityConfig = new Map(); // entityId -> { id, name, type }
const entityState = new Map(); // entityId -> normalized state
const triggerConfig = []; // [{ runtimeKey, source, entityId?, eventType?, eventData?, action, stateEquals, payload, cooldownMs, allowedModes }]
const triggerRuntime = new Map(); // triggerId -> { lastFiredAt, lastState, lastChanged, lastUpdated }
const HA_BUTTON_EVENT_TYPE = 'ha.button.action';
const MQTT_EVENT_TYPES = new Set(['mqtt', 'mqtt_message', 'mqtt_message_received']);

let connection = null;
let unsubscribeEntities = null;
let eventUnsubscribers = [];
let reconnectTimer = null;
let connected = false;

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
  const eventType = String(entry.eventType || entry.event_type || '').trim().toLowerCase();
  let source = null;
  if (entityId) source = 'entity';
  if (!source && eventType) source = 'event';
  if (!source) return null;
  const stateEqualsRaw = entry.stateEquals ?? entry.state_equals;
  const stateEquals =
    stateEqualsRaw === null || stateEqualsRaw === undefined ? null : String(stateEqualsRaw).trim();
  const eventData = entry.eventData && typeof entry.eventData === 'object' ? entry.eventData : null;
  const runtimeKey =
    source === 'entity'
      ? `${action}::entity::${entityId}::${stateEquals || '*'}::${index}`
      : `${action}::event::${eventType}::${index}`;
  const cooldownMs = Number.isFinite(Number(entry.cooldownMs)) ? Math.max(0, Number(entry.cooldownMs)) : 0;
  const allowedModes = Array.isArray(entry.allowedModes)
    ? entry.allowedModes.map((mode) => String(mode || '').trim().toLowerCase()).filter(Boolean)
    : null;
  return {
    runtimeKey,
    source,
    entityId: source === 'entity' ? entityId : null,
    eventType: source === 'event' ? eventType : null,
    eventData: source === 'event' ? eventData : null,
    action,
    stateEquals: source === 'entity' ? stateEquals : null,
    payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {},
    cooldownMs,
    allowedModes,
  };
}

function eventTypeMatches(expected, actual) {
  const exp = String(expected || '').trim().toLowerCase();
  const act = String(actual || '').trim().toLowerCase();
  if (!exp || !act) return false;
  if (exp === act) return true;
  if (exp === 'mqtt' && MQTT_EVENT_TYPES.has(act)) return true;
  return false;
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

function handleEntitySnapshot(snapshot = {}) {
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

function objectContainsSubset(actual, expected) {
  if (!expected || typeof expected !== 'object') return true;
  if (!actual || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actualValue = actual[key];
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      return objectContainsSubset(actualValue, expectedValue);
    }
    return String(actualValue) === String(expectedValue);
  });
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
    if (trigger.source !== 'entity') return;
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

function handleHomeAssistantEvent(event = {}) {
  if (!triggerConfig.length) return;
  const eventType = String(event?.event_type || '').trim().toLowerCase();
  if (!eventType) return;
  triggerConfig.forEach((trigger) => {
    if (trigger.source !== 'event') return;
    if (!eventTypeMatches(trigger.eventType, eventType)) return;
    if (trigger.eventData && !objectContainsSubset(event?.data || {}, trigger.eventData)) return;
    const runtimeState = triggerRuntime.get(trigger.runtimeKey) || {
      lastFiredAt: 0,
      lastState: null,
      lastChanged: null,
      lastUpdated: null,
    };
    dispatchButtonAction(trigger, runtimeState, {
      eventType,
      eventData: event?.data || {},
      timeFired: event?.time_fired || null,
    });
  });
}

function teardownConnection() {
  if (eventUnsubscribers.length) {
    eventUnsubscribers.forEach((unsubscribe) => {
      Promise.resolve()
        .then(() => (typeof unsubscribe === 'function' ? unsubscribe() : null))
        .catch((err) => logger.warn('Failed to unsubscribe Home Assistant event stream', err.message));
    });
  }
  eventUnsubscribers = [];
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
    const eventTypes = Array.from(
      new Set(
        triggerConfig
          .filter((trigger) => trigger.source === 'event' && trigger.eventType)
          .map((trigger) => String(trigger.eventType).toLowerCase()),
      ),
    );
    const hasMqttTrigger = eventTypes.some((type) => type === 'mqtt' || MQTT_EVENT_TYPES.has(type));
    if (hasMqttTrigger) {
      try {
        const unsubscribe = await connection.subscribeEvents(handleHomeAssistantEvent);
        eventUnsubscribers.push(unsubscribe);
        logger.info('Subscribed Home Assistant event stream (all events) for MQTT button matching');
      } catch (err) {
        logger.warn('Failed to subscribe Home Assistant all-event stream', { error: err.message });
      }
    } else {
      for (const eventType of eventTypes) {
        try {
          const unsubscribe = await connection.subscribeEvents(handleHomeAssistantEvent, eventType);
          eventUnsubscribers.push(unsubscribe);
        } catch (err) {
          logger.warn('Failed to subscribe Home Assistant event stream', { eventType, error: err.message });
        }
      }
      if (eventTypes.length) {
        logger.info('Subscribed Home Assistant event streams', { count: eventTypes.length, eventTypes });
      }
    }
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
  await callService(connection, domain, service, { entity_id: entityId });
  logger.info('Issued Home Assistant command', { entityId, domain, service });
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
  await callService(connection, 'light', 'turn_on', { entity_id: entityId, rgb_color: normalized });
  logger.info('Issued Home Assistant color command', { entityId, rgbColor: normalized });
}

function getState() {
  const entities = Array.from(entityConfig.values()).map(
    (meta) => entityState.get(meta.id) || buildState(meta, null),
  );
  return { enabled, connected, entities };
}

loadEntityConfig();
loadTriggerConfig();
connect();

io.on('connection', (socket) => {
  socket.on('homeAssistant:toggle', async ({ entityId } = {}, cb = () => {}) => {
    const mode = getMode();
    if (
      (mode === 'admin' && isAdmin(socket) !== true) ||
      (mode === 'lockdown' && isLockdownAdmin(socket) !== true)
    ) {
      return cb({ error: 'Insufficient permissions to control Home Assistant' });
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

    try {
      if (!entityId) throw new Error('entityId required');
      await setLightColor(entityId, rgbColor);
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

module.exports = {
  getState,
  toggleEntity,
  setEntityState,
  setLightColor,
  homeAssistantEvents: events,
};
