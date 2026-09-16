// Home Assistant Transport
// Purpose: Manages websocket auth connection lifecycle, entity subscription, and reconnect behavior.
// Scope: Handles Home Assistant network transport and service-call plumbing without business policy logic.
const WebSocket = require('ws');
const { createConnection, subscribeEntities, getServices, callService, Auth } = require('home-assistant-js-websocket');
const { runtime } = require('./state');

if (!global.WebSocket) {
  global.WebSocket = WebSocket;
}

function createTransport(deps) {
  const { logger, enabled, haConfig, onSnapshot, onStatus, onServices } = deps;
  let active = true;
  let connection = null;
  let unsubscribeEntities = null;
  let serviceDescriptions = null;
  let serviceUnsubscribers = [];
  let serviceRequest = 0;

  async function refreshServices(owner) {
    if (!active || owner !== connection) return;
    const request = ++serviceRequest;
    try {
      const descriptions = await getServices(owner);
      // A reload or reconnect can finish an old request after the replacement
      // connection starts. Only publish metadata from the current connection.
      if (!active || owner !== connection || request !== serviceRequest) return;
      serviceDescriptions = descriptions;
      onServices?.();
    } catch (error) {
      if (active && owner === connection) logger.warn('Failed to fetch Home Assistant actions', error.message);
    }
  }

  async function watchServices(owner) {
    // The library's subscribeServices inserts empty descriptions for newly
    // registered actions. Fetch full selector metadata instead, on the same
    // registration/removal events, so integration reloads retain their inputs.
    for (const event of ['service_registered', 'service_removed']) {
      if (!active || owner !== connection) return;
      try {
        const unsubscribe = await owner.subscribeEvents(() => refreshServices(owner), event);
        if (!active || owner !== connection) unsubscribe();
        else serviceUnsubscribers.push(unsubscribe);
      } catch (error) {
        if (active && owner === connection) logger.warn('Failed to watch Home Assistant actions', error.message);
      }
    }
    if (active && owner === connection) await refreshServices(owner);
  }
  function getCallerFrame() {
    const stack = new Error().stack || '';
    const lines = stack.split('\n').slice(2).map((line) => line.trim());
    const frame = lines.find((line) => !line.includes('transport.js') && !line.includes('node:internal')) || null;
    return frame;
  }

  function buildAuth() {
    const token = haConfig?.token?.trim();
    const url = haConfig?.url?.trim();
    if (!token || !url) {
      throw new Error('Home Assistant url/token missing');
    }
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

  function teardownConnection() {
    // Retire metadata together with its connection; no old service definitions
    // may authorize writes against a different Home Assistant installation.
    serviceRequest += 1;
    serviceDescriptions = null;
    serviceUnsubscribers.forEach((unsubscribe) => {
      try { unsubscribe(); } catch (error) { logger.warn('Failed to unsubscribe Home Assistant actions', error.message); }
    });
    serviceUnsubscribers = [];
    const ownedUnsubscribe = unsubscribeEntities;
    unsubscribeEntities = null;
    if (ownedUnsubscribe) {
      try {
        ownedUnsubscribe();
      } catch (err) {
        logger.warn('Failed to unsubscribe entity stream', err.message);
      }
    }
    const ownedConnection = connection;
    connection = null;
    if (ownedConnection) {
      try {
        ownedConnection.close();
      } catch (err) {
        logger.warn('Error closing Home Assistant connection', err.message);
      }
    }

    // An old transport's delayed disconnected event must not clear the newer
    // transport stored in shared runtime state after a configuration reload.
    if (runtime.connection === ownedConnection) {
      runtime.connection = null;
      runtime.unsubscribeEntities = null;
      const wasConnected = runtime.connected;
      runtime.connected = false;
      if (wasConnected) onStatus();
    }
  }

  function scheduleReconnect(delayMs = 5000) {
    // A replaced transport must never reconnect after its successor has taken
    // ownership of the shared Home Assistant connection state.
    if (!active || !enabled) return;
    if (runtime.reconnectTimer) return;
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null;
      connect();
    }, delayMs);
  }

  async function connect() {
    if (!active || !enabled) {
      // Disabled and misconfigured are intentionally different states. The
      // explicit switch prevents connection attempts; missing credentials are
      // surfaced by buildAuth() as a runtime connection failure when enabled.
      logger.info('Home Assistant disabled by config');
      return;
    }
    if (connection) return;

    try {
      const auth = buildAuth();
      const nextConnection = await createConnection({ auth, setupRetry: 0 });
      if (!active) {
        nextConnection.close();
        return;
      }
      connection = nextConnection;
      runtime.connection = connection;
      runtime.connected = true;
      onStatus();
      logger.info('Connected to Home Assistant');
      unsubscribeEntities = subscribeEntities(connection, onSnapshot);
      runtime.unsubscribeEntities = unsubscribeEntities;
      void watchServices(connection);
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

  function isConnected() {
    return Boolean(connection && runtime.connection === connection && runtime.connected);
  }

  async function callHomeAssistantService(domain, service, serviceData = {}) {
    if (!active || !enabled) throw new Error('Home Assistant not configured');
    if (!connection || runtime.connection !== connection) throw new Error('Home Assistant not connected');
    if (!domain || !service) throw new Error('domain and service required');
    logger.info('Home Assistant outbound service call', {
      domain: String(domain),
      service: String(service),
      serviceData: serviceData && typeof serviceData === 'object' ? { ...serviceData } : serviceData,
      caller: getCallerFrame(),
    });
    await callService(connection, String(domain), String(service), serviceData || {});
  }

  function disconnect() {
    // Configuration reloads deliberately retire the complete transport. Clear
    // its pending retry before closing so the old credentials cannot race the
    // newly created transport and reclaim the shared connection.
    active = false;
    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }
    teardownConnection();
  }

  return {
    connect,
    disconnect,
    isConnected,
    callHomeAssistantService,
    getServiceDescriptions: () => serviceDescriptions,
  };
}

module.exports = {
  createTransport,
};
