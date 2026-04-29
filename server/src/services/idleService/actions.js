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
  NIGHT_VISION_DISABLE_ACTION,
  DOCK_COMMAND_BASE64,
} = require('./constants');

async function turnOffRoomControls() {
  await homeAssistantService.setAllControllableEntitiesState('off', { source: 'idleService:turnOffRoomControls' });
  return { action: 'roomControlsOff' };
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

async function disableAllRoverNightVision() {
  const attempted = [];
  const failed = [];
  roverManager.rovers.forEach((record) => {
    if (!record?.ws) return;
    const roverId = String(record.id);
    try {
      issueCommand(roverId, {
        type: 'nightVision',
        nightVision: { action: NIGHT_VISION_DISABLE_ACTION },
      });
      attempted.push(roverId);
    } catch (err) {
      failed.push({ roverId, error: err.message });
    }
  });
  return { action: 'disableRoverNightVision', attempted, failed };
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
  dockAllRovers,
  disableAllRoverNightVision,
  sendNeatoHome,
  raiseLift,
];

async function runIdleActions() {
  const results = [];
  for (const action of idleActions) {
    try {
      const result = await action();
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
