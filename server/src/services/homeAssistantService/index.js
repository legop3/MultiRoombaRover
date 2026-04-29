// Home Assistant Service
// Purpose: Composes Home Assistant transport, runtime automation engine, and event/socket hooks.
// Scope: Exposes stable room-control APIs while delegating internals to focused modules.
const logger = require('../../globals/logger').child('homeAssistantService');
const { loadConfig } = require('../../helpers/configLoader');
const { events } = require('./state');
const { createRuntimeEngine } = require('./runtimeEngine');
const { createTransport } = require('./transport');
const { registerHomeAssistantHooks } = require('./hooks');

const config = loadConfig();
const haConfig = config.homeAssistant || {};
const enabled = Boolean(haConfig?.url && haConfig?.token);

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
transport.connect();
runtimeEngine.evaluateLightAutomation();

registerHomeAssistantHooks({
  logger,
  haConfig,
  evaluateLightAutomation: runtimeEngine.evaluateLightAutomation,
  isLightControlLocked: runtimeEngine.isLightControlLocked,
  setLightsLockedOn: runtimeEngine.setLightsLockedOn,
  toggleEntity: runtimeEngine.toggleEntity,
  setEntityState: runtimeEngine.setEntityState,
  setLightColor: runtimeEngine.setLightColor,
  setLightWhite: runtimeEngine.setLightWhite,
});

module.exports = {
  getState: runtimeEngine.getState,
  isConnected: transport.isConnected,
  enabled,
  getLightPolicyState: runtimeEngine.getLightPolicyState,
  isLightControlLocked: runtimeEngine.isLightControlLocked,
  getRawEntitySnapshot: runtimeEngine.getRawEntitySnapshot,
  callHomeAssistantService: transport.callHomeAssistantService,
  toggleEntity: runtimeEngine.toggleEntity,
  setEntityState: runtimeEngine.setEntityState,
  setLightColor: runtimeEngine.setLightColor,
  setLightWhite: runtimeEngine.setLightWhite,
  setLightsLockedOn: runtimeEngine.setLightsLockedOn,
  toggleLightsLockedOn: runtimeEngine.toggleLightsLockedOn,
  homeAssistantEvents: events,
};
