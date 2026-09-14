// Home Assistant Service
// Purpose: Composes Home Assistant transport, runtime automation engine, and event/socket hooks.
// Scope: Exposes stable room-control APIs while delegating internals to focused modules.
const logger = require('../../globals/logger').child('homeAssistantService');
const { loadConfig } = require('../../configuration');
const { events } = require('./state');
const { createRuntimeEngine } = require('./runtimeEngine');
const { createTransport } = require('./transport');
const { registerHomeAssistantHooks } = require('./hooks');

const config = loadConfig();
const haConfig = config.homeAssistant || {};
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
  /*
    Loading the module should be harmless on rover-only installs. The explicit
    service-owned switch alone decides whether connection should be attempted;
    missing credentials are then reported as a runtime connection failure.
  */
  transport.connect();
}

if (enabled) {
  /*
    Socket routes are part of the visible Home Assistant feature. Register them
    only when enabled so disabled installs do not expose hidden controls that
    the UI has intentionally removed.
  */
  registerHomeAssistantHooks({
    logger,
    haConfig,
    isLightControlLocked: runtimeEngine.isLightControlLocked,
    setLightsLockedOn: runtimeEngine.setLightsLockedOn,
    toggleEntity: runtimeEngine.toggleEntity,
    setEntityState: runtimeEngine.setEntityState,
    setLightColor: runtimeEngine.setLightColor,
    setLightWhite: runtimeEngine.setLightWhite,
  });
}

module.exports = {
  getState: runtimeEngine.getState,
  isConnected: transport.isConnected,
  enabled,
  getLightPolicyState: runtimeEngine.getLightPolicyState,
  isLightControlLocked: runtimeEngine.isLightControlLocked,
  getRawEntitySnapshot: runtimeEngine.getRawEntitySnapshot,
  getControllableEntityIds: runtimeEngine.getControllableEntityIds,
  callHomeAssistantService: transport.callHomeAssistantService,
  toggleEntity: runtimeEngine.toggleEntity,
  setEntityState: runtimeEngine.setEntityState,
  setLightColor: runtimeEngine.setLightColor,
  setLightWhite: runtimeEngine.setLightWhite,
  setAllControllableEntitiesState: runtimeEngine.setAllControllableEntitiesState,
  setRandomColorScene: runtimeEngine.setRandomColorScene,
  setLightsLockedOn: runtimeEngine.setLightsLockedOn,
  toggleLightsLockedOn: runtimeEngine.toggleLightsLockedOn,
  homeAssistantEvents: events,
};
