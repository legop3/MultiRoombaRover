// Home Assistant Service
// Purpose: Composes Home Assistant transport, runtime automation engine, and event/socket hooks.
// Scope: Exposes stable room-control APIs while delegating internals to focused modules.
const logger = require('../../globals/logger').child('homeAssistantService');
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const { events } = require('./state');
const { createRuntimeEngine } = require('./runtimeEngine');
const { createTransport } = require('./transport');
const { registerHomeAssistantHooks } = require('./hooks');

let current;

function createHomeAssistantRuntime(haConfig = {}) {
  const enabled = Boolean(haConfig.enabled);
  let callHomeAssistantServiceImpl = async () => {
    throw new Error('Home Assistant not connected');
  };
  const runtimeEngine = createRuntimeEngine({
    logger,
    enabled,
    haConfig,
    callHomeAssistantService: (...args) => callHomeAssistantServiceImpl(...args),
  });
  const transport = createTransport({
    logger,
    enabled,
    haConfig,
    onSnapshot: runtimeEngine.handleEntitySnapshot,
    onStatus: () => runtimeEngine.emitStatus(runtimeEngine.getState),
  });
  callHomeAssistantServiceImpl = transport.callHomeAssistantService;
  runtimeEngine.loadEntityConfig();
  runtimeEngine.loadTriggerConfig();
  if (enabled) {
    // A service reload creates one fresh transport with the new credentials and
    // entity schema. Disabled installations perform no network work.
    transport.connect();
  }
  return { enabled, haConfig, runtimeEngine, transport };
}

function replaceHomeAssistantRuntime(haConfig) {
  current?.transport.disconnect();
  current = createHomeAssistantRuntime(haConfig);
}

replaceHomeAssistantRuntime(loadConfig().homeAssistant || {});

/*
  Browser and mode hooks are registered exactly once. Their delegates resolve
  `current` for every call, so a configuration save does not duplicate socket
  listeners while still routing existing connections into the new runtime.
*/
registerHomeAssistantHooks({
  logger,
  getHaConfig: () => current.haConfig,
  isLightControlLocked: (...args) => current.runtimeEngine.isLightControlLocked(...args),
  setLightsLockedOn: (...args) => current.runtimeEngine.setLightsLockedOn(...args),
  toggleEntity: (...args) => current.runtimeEngine.toggleEntity(...args),
  setEntityState: (...args) => current.runtimeEngine.setEntityState(...args),
  setLightColor: (...args) => current.runtimeEngine.setLightColor(...args),
  setLightWhite: (...args) => current.runtimeEngine.setLightWhite(...args),
});

registerConfigurationHandler('homeAssistant', (haConfig) => {
  replaceHomeAssistantRuntime(haConfig || {});
});

module.exports = {
  getState: (...args) => current.runtimeEngine.getState(...args),
  isConnected: (...args) => current.transport.isConnected(...args),
  get enabled() {
    return current.enabled;
  },
  getLightPolicyState: (...args) => current.runtimeEngine.getLightPolicyState(...args),
  isLightControlLocked: (...args) => current.runtimeEngine.isLightControlLocked(...args),
  getRawEntitySnapshot: (...args) => current.runtimeEngine.getRawEntitySnapshot(...args),
  getControllableEntityIds: (...args) => current.runtimeEngine.getControllableEntityIds(...args),
  callHomeAssistantService: (...args) => current.transport.callHomeAssistantService(...args),
  toggleEntity: (...args) => current.runtimeEngine.toggleEntity(...args),
  setEntityState: (...args) => current.runtimeEngine.setEntityState(...args),
  setLightColor: (...args) => current.runtimeEngine.setLightColor(...args),
  setLightWhite: (...args) => current.runtimeEngine.setLightWhite(...args),
  setAllControllableEntitiesState: (...args) => current.runtimeEngine.setAllControllableEntitiesState(...args),
  setRandomColorScene: (...args) => current.runtimeEngine.setRandomColorScene(...args),
  setLightsLockedOn: (...args) => current.runtimeEngine.setLightsLockedOn(...args),
  toggleLightsLockedOn: (...args) => current.runtimeEngine.toggleLightsLockedOn(...args),
  homeAssistantEvents: events,
};
