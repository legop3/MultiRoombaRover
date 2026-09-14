// Configuration Service
// Purpose: Exposes the process-wide live configuration snapshot, service reload registry, and administration store.
// Scope: Makes SQLite the durable source while applying each committed revision coherently to the running process.
const EventEmitter = require('events');
const { isDeepStrictEqual } = require('util');
const { createConfigurationDatabase } = require('./database');
const { definitions, rootSchema, featureDefinitions } = require('./definition');

let singleton;
let runtimeConfiguration;
let runtimeConfigurationRevision = null;
let applicationQueue = Promise.resolve();
let lastApplication = null;
const reloadHandlers = new Map();
const configurationEvents = new EventEmitter();

function getConfigurationDatabase() {
  if (!singleton) {
    singleton = createConfigurationDatabase();
    // Durable state is read once at startup and then replaced atomically after
    // each committed save or rollback. Every caller therefore sees one complete
    // revision rather than independently rereading SQLite mid-application.
    const active = singleton.getActiveConfigurationRecord();
    runtimeConfiguration = Object.freeze(active.config);
    runtimeConfigurationRevision = active.revision;
    lastApplication = {
      revision: active.revision,
      changedSections: [],
      services: [],
      appliedAt: Date.now(),
    };
  }
  return singleton;
}

function getRuntimeConfigurationRevision() {
  getConfigurationDatabase();
  return runtimeConfigurationRevision;
}

function loadConfig() {
  getConfigurationDatabase();
  return runtimeConfiguration;
}

function registerConfigurationHandler(section, handler) {
  if (!rootSchema.properties?.[section]) {
    throw new Error(`Cannot register configuration handler for unknown section ${section}.`);
  }
  if (typeof handler !== 'function') {
    throw new Error(`Configuration handler for ${section} must be a function.`);
  }
  const handlers = reloadHandlers.get(section) || new Set();
  handlers.add(handler);
  reloadHandlers.set(section, handlers);
  return () => handlers.delete(handler);
}

async function applyCommittedConfiguration() {
  /*
    Saves are serialized even though SQLite commits synchronously. A service
    reload may need to close a worker or network client asynchronously, and a
    later revision must never overtake that cleanup and start a second runtime.
  */
  const apply = async () => {
    const active = getConfigurationDatabase().getActiveConfigurationRecord();
    const previous = loadConfig();
    const next = Object.freeze(active.config);
    const changedSections = definitions
      .map(({ key }) => key)
      .filter((key) => !isDeepStrictEqual(previous[key], next[key]));

    // Swap the complete document before invoking handlers. Any service helper
    // consulted during a reload consequently observes the same new revision.
    runtimeConfiguration = next;
    runtimeConfigurationRevision = active.revision;

    const services = [];
    for (const section of changedSections) {
      for (const handler of reloadHandlers.get(section) || []) {
        try {
          // Sequential application preserves the server's existing dependency
          // order, notably Home Assistant before its Neato and lift consumers.
          await handler(next[section], previous[section], next, previous);
          services.push({ section, status: 'applied' });
        } catch (error) {
          // One unavailable integration must not prevent unrelated services or
          // the session feature map from receiving the committed revision.
          services.push({ section, status: 'failed', error: error.message });
        }
      }
    }

    lastApplication = {
      revision: active.revision,
      changedSections,
      services,
      appliedAt: Date.now(),
    };
    configurationEvents.emit('applied', lastApplication);
    return lastApplication;
  };

  const queued = applicationQueue.then(apply, apply);
  // Retain a fulfilled tail even if an unexpected coordinator error escapes;
  // otherwise one failure would permanently poison every later save.
  applicationQueue = queued.catch(() => undefined);
  return queued;
}

function getLastConfigurationApplication() {
  getConfigurationDatabase();
  return lastApplication;
}

function getValueAtPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function getFeatureFlags(config = loadConfig()) {
  /*
    Feature definitions come directly from service-owned configuration metadata.
    Returning an explicit boolean map preserves the existing public session
    contract while ensuring the item's enabled field is its only source.
  */
  return Object.fromEntries(featureDefinitions.map(({ key, path }) => [
    key,
    Boolean(getValueAtPath(config, path)),
  ]));
}

function isFeatureEnabled(featureName) {
  return Boolean(getFeatureFlags()[featureName]);
}

module.exports = {
  getConfigurationDatabase,
  getRuntimeConfigurationRevision,
  getLastConfigurationApplication,
  registerConfigurationHandler,
  applyCommittedConfiguration,
  configurationEvents,
  loadConfig,
  getFeatureFlags,
  isFeatureEnabled,
  rootSchema,
};
