const EventEmitter = require('events');
const WebSocket = require('ws');
const { createConnection, subscribeEntities, callService, Auth } = require('home-assistant-js-websocket');
const io = require('../globals/io');
const logger = require('../globals/logger').child('homeAssistantService');
const { loadConfig } = require('../helpers/configLoader');
const { getMode } = require('./modeManager');
const { isAdmin } = require('./roleService');

// home-assistant-js-websocket expects a global WebSocket in Node.
if (!global.WebSocket) {
  global.WebSocket = WebSocket;
}

const config = loadConfig();
const haConfig = config.homeAssistant || {};

const events = new EventEmitter();
const entityConfig = new Map(); // entityId -> { id, name, type }
const entityState = new Map(); // entityId -> normalized state

let connection = null;
let unsubscribeEntities = null;
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

function buildState(meta, raw) {
  if (!meta) return null;
  const name = meta.name || raw?.attributes?.friendly_name || meta.id;
  if (!raw) {
    return {
      id: meta.id,
      name,
      type: meta.type,
      state: 'unknown',
      available: false,
      lastChanged: null,
      lastUpdated: null,
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
  await callService(connection, domain, service, { entity_id: entityId });
  logger.info('Issued Home Assistant command', { entityId, domain, service });
}

async function toggleEntity(entityId) {
  const current = entityState.get(entityId);
  const nextState = current?.state === 'on' ? 'off' : 'on';
  return setEntityState(entityId, nextState);
}

function getState() {
  const entities = Array.from(entityConfig.values()).map(
    (meta) => entityState.get(meta.id) || buildState(meta, null),
  );
  return { enabled, connected, entities };
}

loadEntityConfig();
connect();

io.on('connection', (socket) => {
  socket.on('homeAssistant:toggle', async ({ entityId } = {}, cb = () => {}) => {
    if ((getMode() === 'admin' || getMode() === 'lockdown') && isAdmin(socket) !== true) {
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
    if ((getMode() === 'admin' || getMode() === 'lockdown') && isAdmin(socket) !== true) {
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
});

module.exports = {
  getState,
  toggleEntity,
  setEntityState,
  homeAssistantEvents: events,
};
