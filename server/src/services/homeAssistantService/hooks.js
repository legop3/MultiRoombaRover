// Home Assistant Hooks
// Purpose: Registers turn/mode/socket event handlers that invoke Home Assistant runtime operations.
// Scope: Owns permission-gated socket routes and service-triggered automation reevaluation wiring.
const io = require('../../globals/io');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { isAdmin, isLockdownAdmin } = require('../roleService');
const { turnEvents } = require('../turnService');

function registerHomeAssistantHooks(deps) {
  const {
    logger,
    haConfig,
    evaluateLightAutomation,
    isLightControlLocked,
    setLightsLockedOn,
    toggleEntity,
    setEntityState,
    setLightColor,
    setLightWhite,
  } = deps;

  turnEvents.on('activeDriver', () => {
    evaluateLightAutomation();
  });

  turnEvents.on('queue', () => {
    evaluateLightAutomation();
  });

  modeEvents.on('change', (mode) => {
    if (mode === MODES.ADMIN || mode === MODES.LOCKDOWN) {
      if (isLightControlLocked()) {
        setLightsLockedOn(false, { source: 'modeGateReset' }).catch((err) => {
          logger.warn('Failed to disable lights lock on mode change', err.message);
        });
      } else {
        evaluateLightAutomation();
      }
      return;
    }
    evaluateLightAutomation();
  });

  io.on('connection', (socket) => {
    function hasPermission() {
      const mode = getMode();
      if (mode === 'admin' && isAdmin(socket) !== true) return false;
      if (mode === 'lockdown' && isLockdownAdmin(socket) !== true) return false;
      return true;
    }

    socket.on('homeAssistant:toggle', async ({ entityId } = {}, cb = () => {}) => {
      if (!hasPermission()) {
        return cb({ error: 'Insufficient permissions to control Home Assistant' });
      }
      if (isLightControlLocked()) {
        return cb({ error: 'Room controls are locked' });
      }
      try {
        if (!entityId) throw new Error('entityId required');
        await toggleEntity(entityId);
        cb({ success: true });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('homeAssistant:setState', async ({ entityId, state } = {}, cb = () => {}) => {
      if (!hasPermission()) {
        return cb({ error: 'Insufficient permissions to control Home Assistant' });
      }
      if (isLightControlLocked()) {
        return cb({ error: 'Room controls are locked' });
      }
      try {
        if (!entityId) throw new Error('entityId required');
        await setEntityState(entityId, state);
        cb({ success: true });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('homeAssistant:lightColor', async ({ entityId, rgbColor } = {}, cb = () => {}) => {
      if (!hasPermission()) {
        return cb({ error: 'Insufficient permissions to control Home Assistant' });
      }
      if (isLightControlLocked()) {
        return cb({ error: 'Room controls are locked' });
      }
      try {
        if (!entityId) throw new Error('entityId required');
        await setLightColor(entityId, rgbColor);
        cb({ success: true });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('homeAssistant:lightWhite', async ({ entityId } = {}, cb = () => {}) => {
      if (!hasPermission()) {
        return cb({ error: 'Insufficient permissions to control Home Assistant' });
      }
      if (isLightControlLocked()) {
        return cb({ error: 'Room controls are locked' });
      }
      try {
        if (!entityId) throw new Error('entityId required');
        await setLightWhite(entityId, haConfig?.whiteKelvin);
        cb({ success: true });
      } catch (err) {
        cb({ error: err.message });
      }
    });
  });
}

module.exports = {
  registerHomeAssistantHooks,
};
