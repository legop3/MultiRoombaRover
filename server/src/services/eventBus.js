const EventEmitter = require('events');
const baseLogger = require('../globals/logger');
const logger = baseLogger.child ? baseLogger.child('eventBus') : baseLogger;

const eventBus = new EventEmitter();

/**
 * Publish a structured event onto the server-wide bus.
 * @param {object} options
 * @param {string} options.source - Origin module identifier.
 * @param {string} options.type - Event type name.
 * @param {any} [options.payload] - Optional event payload.
 */
function publishEvent({ source, type, payload = null }) {
  if (!source) {
    throw new Error('eventBus.publishEvent requires source');
  }
  if (!type) {
    throw new Error('eventBus.publishEvent requires type');
  }
  const event = {
    source,
    type,
    payload,
    ts: Date.now(),
  };
  const logFn = typeof logger.debug === 'function' ? 'debug' : 'info';
  logger[logFn](`Publishing event ${type}`, { source });
  eventBus.emit(type, event);
  eventBus.emit('*', event);
}

/**
 * Subscribe to events of a given type.
 * @param {string} type
 * @param {(event: object) => void} handler
 */
function subscribe(type, handler) {
  eventBus.on(type, handler);
  return () => eventBus.off(type, handler);
}

/**
 * Subscribe to all events on the bus.
 * @param {(event: object) => void} handler
 */
function subscribeAll(handler) {
  eventBus.on('*', handler);
  return () => eventBus.off('*', handler);
}

module.exports = {
  eventBus,
  publishEvent,
  subscribe,
  subscribeAll,
};
