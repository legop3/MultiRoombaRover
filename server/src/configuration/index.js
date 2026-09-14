// Configuration Service
// Purpose: Exposes the process-wide synchronous configuration snapshot and the underlying administration store.
// Scope: Keeps existing require-time startup semantics while making SQLite the only runtime configuration source.
const { createConfigurationDatabase } = require('./database');
const { rootSchema, featureDefinitions } = require('./definition');

let singleton;
let runtimeConfigurationRevision = null;

function getConfigurationDatabase() {
  if (!singleton) {
    singleton = createConfigurationDatabase();
    /*
      Capture the active revision once when the process opens its configuration
      store. Later admin saves are intentionally restart-bound, so comparing
      against this value gives every reconnecting browser an authoritative
      pending-restart indicator.
    */
    runtimeConfigurationRevision = singleton.getActiveConfigurationRecord().revision;
  }
  return singleton;
}

function getRuntimeConfigurationRevision() {
  getConfigurationDatabase();
  return runtimeConfigurationRevision;
}

function loadConfig() {
  /*
    Services intentionally receive one coherent snapshot for this process.
    Configuration commits are restart-bound, so re-reading during runtime would
    let only some modules observe the new revision and create a split-brain
    process. The database remains queryable through its administrative API.
  */
  if (!loadConfig.cached) {
    loadConfig.cached = Object.freeze(getConfigurationDatabase().getActiveConfigurationRecord().config);
  }
  return loadConfig.cached;
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
  loadConfig,
  getFeatureFlags,
  isFeatureEnabled,
  rootSchema,
};
