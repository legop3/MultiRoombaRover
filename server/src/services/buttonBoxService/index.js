// button Box Service
// Purpose: Composes button-box storage, core reward workflows, and HTTP route wiring.
// Scope: Keeps runtime behavior unchanged while making this entrypoint a thin composition layer.
const { app } = require('../../globals/http');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('buttonBoxService');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const { publishEvent } = require('../eventBus');
const { getRewardById, listRewards } = require('../../rewards');
const roverManager = require('../roverManager');
const { issueCommand } = require('../commandService');
const { sendAlert } = require('../alertService');
const { sendExternalTyping, sendExternalMessage, sendSystemMessage } = require('../chatService');
const { setMode, getMode } = require('../modeManager');
const { getAdminReason, setAdminReason, clearAdminReason } = require('../adminReasonService');
const assignmentService = require('../assignmentService');
const {
  getState: getHomeAssistantState,
  setEntityState: setHomeAssistantEntityState,
  setLightsLockedOn: setHomeAssistantLightsLockedOn,
} = require('../homeAssistantService');
const { isLocalNetwork, normalizeIp } = require('../../helpers/ipResolver');
const { createButtonBoxStore } = require('./store');
const { createButtonBoxCore } = require('./core');
const { registerButtonBoxRoute } = require('./httpRoute');

const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('buttonbox-state.json');
const BUTTON_COUNT = 4;
const STORE_VERSION = 1;

const store = createButtonBoxStore({
  logger,
  getRewardById,
  listRewards,
  dataDir: DATA_DIR,
  storePath: STORE_PATH,
  buttonCount: BUTTON_COUNT,
  storeVersion: STORE_VERSION,
});

const core = createButtonBoxCore({
  io,
  logger,
  getRewardById,
  roverManager,
  issueCommand,
  sendAlert,
  publishEvent,
  sendExternalTyping,
  sendExternalMessage,
  sendSystemMessage,
  getMode,
  setMode,
  getAdminReason,
  setAdminReason,
  clearAdminReason,
  assignmentService,
  getHomeAssistantState,
  setHomeAssistantEntityState,
  setHomeAssistantLightsLockedOn,
  store,
});

registerButtonBoxRoute({
  app,
  logger,
  buttonCount: BUTTON_COUNT,
  normalizeIp,
  isLocalNetwork,
  applyPress: core.applyPress,
});

store.loadState();
core.recoverEffects().catch((err) => {
  logger.warn('Button box effect recovery failed', err.message);
});

module.exports = {
  getButtonBoxState: store.getStateClone,
  addButtonBoxCount: core.addCount,
};
