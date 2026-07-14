// Home Assistant Hooks
// Purpose: Registers turn/mode/socket event handlers that invoke Home Assistant runtime operations.
// Scope: Owns permission-gated socket routes and service-triggered automation reevaluation wiring.
const io = require('../../globals/io');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { isAdmin, isLockdownAdmin } = require('../roleService');

function registerHomeAssistantHooks(deps) {
  const {
    logger,
    haConfig,
    isLightControlLocked,
    setLightsLockedOn,
    toggleEntity,
    setEntityState,
    setLightColor,
    setLightWhite,
  } = deps;

  modeEvents.on('change', (mode) => {
    if (mode === MODES.ADMIN || mode === MODES.LOCKDOWN) {
      if (isLightControlLocked()) {
        setLightsLockedOn(false, { source: 'modeGateReset' }).catch((err) => {
          logger.warn('Failed to disable lights lock on mode change', err.message);
        });
      }
    }
  });

  io.on('connection', (socket) => {
    function hasPermission() {
      const mode = getMode();
      if (mode === 'admin' && isAdmin(socket) !== true) return false;
      if (mode === 'lockdown' && isLockdownAdmin(socket) !== true) return false;
      return true;
    }

    function isBlockedByRoomControlLock() {
      /*
        The lock is meant to keep normal users and automated room-control
        surfaces from changing the preferred room-light policy. Admins are the
        exception because they may need to correct a single lamp, verify a Home
        Assistant integration, or make an operational adjustment while the
        public controls remain locked.

        This server-side bypass is the authoritative rule. The React UI also
        enables admin controls for usability, but clients are not trusted to
        enforce permissions.
      */
      return isLightControlLocked() && !isAdmin(socket);
    }

    socket.on('homeAssistant:toggle', async ({ entityId } = {}, cb = () => {}) => {
      if (!hasPermission()) {
        return cb({ error: 'Insufficient permissions to control Home Assistant' });
      }
      if (isBlockedByRoomControlLock()) {
        return cb({ error: 'Room controls are locked' });
      }
      try {
        if (!entityId) throw new Error('entityId required');
        await toggleEntity(entityId, { source: `socket:${socket.id}:homeAssistant:toggle` });
        cb({ success: true });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('homeAssistant:setState', async ({ entityId, state } = {}, cb = () => {}) => {
      if (!hasPermission()) {
        return cb({ error: 'Insufficient permissions to control Home Assistant' });
      }
      if (isBlockedByRoomControlLock()) {
        return cb({ error: 'Room controls are locked' });
      }
      try {
        if (!entityId) throw new Error('entityId required');
        await setEntityState(entityId, state, { source: `socket:${socket.id}:homeAssistant:setState` });
        cb({ success: true });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('homeAssistant:lightColor', async ({ entityId, colorHex, rgbColor } = {}, cb = () => {}) => {
      if (!hasPermission()) {
        return cb({ error: 'Insufficient permissions to control Home Assistant' });
      }
      if (isBlockedByRoomControlLock()) {
        return cb({ error: 'Room controls are locked' });
      }
      try {
        if (!entityId) throw new Error('entityId required');
        // New browser clients send colorHex because it is directly usable by
        // React/CSS. rgbColor remains accepted for compatibility with any older
        // client that still sends Home Assistant-style RGB arrays.
        await setLightColor(entityId, colorHex ?? rgbColor);
        cb({ success: true });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('homeAssistant:lightWhite', async ({ entityId } = {}, cb = () => {}) => {
      if (!hasPermission()) {
        return cb({ error: 'Insufficient permissions to control Home Assistant' });
      }
      if (isBlockedByRoomControlLock()) {
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
