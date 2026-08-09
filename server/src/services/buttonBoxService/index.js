// button Box Service
// Purpose: Composes button-box storage, core reward workflows, and HTTP route wiring.
// Scope: Keeps runtime behavior unchanged while making this entrypoint a thin composition layer.
const { app } = require('../../globals/http');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('buttonBoxService');
const { isFeatureEnabled } = require('../../helpers/features');
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
const greenModeService = require('../greenModeService');

const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('buttonbox-state.json');
const BUTTON_COUNT = 4;
const STORE_VERSION = 1;
const enabled = isFeatureEnabled('buttonBox');

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
  setGreenMode: greenModeService.setEnabled,
  isGreenModeEnabled: greenModeService.isEnabled,
  // Return an explicit cleanup function so timed rewards can stop observing
  // the global service when they expire, rerun, or are recovered.
  onGreenModeChange: (listener) => {
    greenModeService.greenModeEvents.on('change', listener);
    return () => greenModeService.greenModeEvents.off('change', listener);
  },
  store,
});

if (enabled) {
  /*
    The button box is physical local hardware, so disabled public installs
    should not expose its LAN-only press endpoint or initialize its reward file.
  */
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
} else {
  logger.info('Button box disabled by config');
}

module.exports = {
  getButtonBoxState: () => {
    /*
      Session sync still includes a buttonBox key for a stable payload shape,
      but disabled mode must not create/read the persisted button-box store.
    */
    if (!enabled) return { buttons: [] };
    return store.getStateClone();
  },
  addButtonBoxCount: (...args) => {
    if (!enabled) throw new Error('Button box is disabled');
    return core.addCount(...args);
  },
};
