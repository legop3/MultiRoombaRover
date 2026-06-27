// Idle Service Actions
// Purpose: Implements the expandable action pipeline executed when the system remains idle.
// Scope: Provides isolated action handlers and shared execution helpers for idle automation.
const logger = require('../../globals/logger').child('idleService');
const roverManager = require('../roverManager');
const { issueCommand } = require('../commandService');
const homeAssistantService = require('../homeAssistantService');
const neatoService = require('../neatoService');
const liftService = require('../liftService');
const {
  HEADLIGHT_DISABLE_ACTION,
  LASER_DISABLE_ACTION,
  DOCK_COMMAND_BASE64,
} = require('./constants');

async function turnOffRoomControls() {
  const lightPolicy = homeAssistantService.getLightPolicyState?.() || null;
  const lockState = lightPolicy?.lockState || null;
  if (lockState === 'on') {
    logger.info('Idle room-controls off skipped because room controls are locked on', {
      lockState,
      source: 'idleService:turnOffRoomControls',
    });
    return {
      action: 'roomControlsOff',
      skipped: true,
      reason: 'lightsLockedOn',
      lockState,
    };
  }

  const before = homeAssistantService.getState?.().entities || [];
  const summary = await homeAssistantService.setAllControllableEntitiesState('off', {
    source: 'idleService:turnOffRoomControls',
  });
  const after = homeAssistantService.getState?.().entities || [];
  logger.info('Idle room-controls off summary', {
    attempted: summary?.total || 0,
    succeeded: Array.isArray(summary?.succeeded) ? summary.succeeded.length : 0,
    failed: Array.isArray(summary?.failures) ? summary.failures.length : 0,
    failedEntities: summary?.failures || [],
    beforeStates: before.map((entity) => ({ id: entity.id, state: entity.state, available: entity.available })),
    afterStates: after.map((entity) => ({ id: entity.id, state: entity.state, available: entity.available })),
  });
  return { action: 'roomControlsOff', ...summary };
}

async function dockAllRovers() {
  const attempted = [];
  const failed = [];
  roverManager.rovers.forEach((record) => {
    if (!record?.ws) return;
    const roverId = String(record.id);
    try {
      issueCommand(roverId, { type: 'raw', raw: DOCK_COMMAND_BASE64 });
      attempted.push(roverId);
    } catch (err) {
      failed.push({ roverId, error: err.message });
    }
  });
  return { action: 'dockAllRovers', attempted, failed };
}

async function disableAllRoverHeadlights() {
  const attempted = [];
  const failed = [];
  roverManager.rovers.forEach((record) => {
    if (!record?.ws) return;
    const roverId = String(record.id);
    try {
      issueCommand(roverId, {
        type: 'headlight',
        headlight: { action: HEADLIGHT_DISABLE_ACTION },
      });
      attempted.push(roverId);
    } catch (err) {
      failed.push({ roverId, error: err.message });
    }
  });
  return { action: 'disableRoverHeadlights', attempted, failed };
}

async function disableAllRoverLasers() {
  const attempted = [];
  const failed = [];
  roverManager.rovers.forEach((record) => {
    if (!record?.ws || !record?.meta?.laser?.enabled) return;
    const roverId = String(record.id);
    try {
      // Idle cleanup is allowed to send an explicit off command even when
      // other laser commands are policy-blocked. The point of this action is
      // to leave the rover in a non-emitting state when nobody is actively
      // driving it.
      issueCommand(roverId, {
        type: 'laser',
        laser: { action: LASER_DISABLE_ACTION },
      });
      attempted.push(roverId);
    } catch (err) {
      failed.push({ roverId, error: err.message });
    }
  });
  return { action: 'disableRoverLasers', attempted, failed };
}

async function sendNeatoHome() {
  try {
    await neatoService.sendHome();
    return { action: 'neatoSendHome', success: true };
  } catch (err) {
    return { action: 'neatoSendHome', success: false, error: err.message };
  }
}

async function raiseLift() {
  try {
    await liftService.moveUp('idleService');
    return { action: 'liftMoveUp', success: true };
  } catch (err) {
    return { action: 'liftMoveUp', success: false, error: err.message };
  }
}

const idleActions = [
  turnOffRoomControls,
  // dockAllRovers,
  disableAllRoverHeadlights,
  disableAllRoverLasers,
  sendNeatoHome,
  raiseLift,
];

async function runIdleActions() {
  const results = [];
  logger.info('Idle action pipeline starting', {
    actions: idleActions.map((action) => action.name),
  });
  for (const action of idleActions) {
    try {
      const result = await action();
      logger.info('Idle action completed', { action: action.name, result });
      results.push({ ok: true, result });
    } catch (err) {
      logger.warn('Idle action failed', { action: action.name, error: err.message });
      results.push({ ok: false, action: action.name, error: err.message });
    }
  }
  return results;
}

module.exports = {
  runIdleActions,
};
