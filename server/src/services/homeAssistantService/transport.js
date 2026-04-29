// Home Assistant Transport
// Purpose: Manages websocket auth connection lifecycle, entity subscription, and reconnect behavior.
// Scope: Handles Home Assistant network transport and service-call plumbing without business policy logic.
const WebSocket = require('ws');
const { createConnection, subscribeEntities, callService, Auth } = require('home-assistant-js-websocket');
const { runtime } = require('./state');

if (!global.WebSocket) {
  global.WebSocket = WebSocket;
}

function createTransport(deps) {
  const { logger, enabled, haConfig, onSnapshot, onStatus } = deps;
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
    if (runtime.unsubscribeEntities) {
      try {
        runtime.unsubscribeEntities();
      } catch (err) {
        logger.warn('Failed to unsubscribe entity stream', err.message);
      }
    }
    runtime.unsubscribeEntities = null;

    if (runtime.connection) {
      try {
        runtime.connection.close();
      } catch (err) {
        logger.warn('Error closing Home Assistant connection', err.message);
      }
    }

    runtime.connection = null;
    const wasConnected = runtime.connected;
    runtime.connected = false;
    if (wasConnected) {
      onStatus();
    }
  }

  function scheduleReconnect(delayMs = 5000) {
    if (!enabled) return;
    if (runtime.reconnectTimer) return;
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null;
      connect();
    }, delayMs);
  }

  async function connect() {
    if (!enabled) {
      logger.info('Home Assistant integration disabled; missing url/token in config');
      return;
    }
    if (runtime.connection) return;

    try {
      const auth = buildAuth();
      runtime.connection = await createConnection({ auth, setupRetry: 0 });
      runtime.connected = true;
      onStatus();
      logger.info('Connected to Home Assistant');
      runtime.unsubscribeEntities = subscribeEntities(runtime.connection, onSnapshot);
      runtime.connection.addEventListener('disconnected', () => {
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
    return Boolean(runtime.connection && runtime.connected);
  }

  async function callHomeAssistantService(domain, service, serviceData = {}) {
    if (!enabled) throw new Error('Home Assistant not configured');
    if (!runtime.connection) throw new Error('Home Assistant not connected');
    if (!domain || !service) throw new Error('domain and service required');
    logger.info('Home Assistant outbound service call', {
      domain: String(domain),
      service: String(service),
      serviceData: serviceData && typeof serviceData === 'object' ? { ...serviceData } : serviceData,
      caller: getCallerFrame(),
    });
    await callService(runtime.connection, String(domain), String(service), serviceData || {});
  }

  return {
    connect,
    isConnected,
    callHomeAssistantService,
  };
}

module.exports = {
  createTransport,
};
