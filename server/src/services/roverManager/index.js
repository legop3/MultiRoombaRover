// rover Manager
// Purpose: Composes rover-manager policy, lifecycle, sensor, and socket modules into the public service API.
// Scope: Keeps runtime behavior unchanged while making this entrypoint a thin wiring/orchestration layer.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('roverManager');
const { sendAlert } = require('../alertService');
const { parseSensorFrame } = require('../../helpers/sensorDecoder');
const { MODES, getMode } = require('../modeManager');
const { isAdmin, isLockdownAdmin, roleEvents } = require('../roleService');
const { publishEvent } = require('../eventBus');
const videoSessions = require('../videoSessions');
const turnService = require('../turnService');
const {
  ALERT_COLOR,
  DOCK_GUARD_WINDOW_MS,
  IDLE_UNDOCKED_MS,
  PASSIVE_UNDOCKED_MS,
  DOCK_GUARD_RETRY_MS,
  DOCK_COMMAND_BASE64,
  BACKOFF_MS,
  BACKOFF_SPEED,
  PRIVATE_BUTTON_HOLD_MS,
  PRIVATE_AUTO_CLOSE_IDLE_MS,
  PRIVATE_AUTO_CLOSE_TICK_MS,
  SAFETY_BACKOFF_MIN,
  SAFETY_BACKOFF_MAX,
  DEFAULT_PRIVATE_SAFETY,
} = require('./constants');
const {
  rovers,
  socketToRovers,
  spectatorSockets,
  managerEvents,
  backoffTimers,
  dockGuardStates,
  privateButtonStates,
  privateNoUsersSince,
  privateSafetyTimers,
  privateSafetyStates,
} = require('./state');
const { normalizePrivateSafety, clampInt, computeBatteryState } = require('./mathUtils');
const { createPrivateAccessPolicy } = require('./privateAccess');
const { createSensorPipeline } = require('./sensorPipeline');
const { createRoverLifecycle } = require('./roverLifecycle');
const { createRosterLifecycle } = require('./rosterLifecycle');
const { createSpectatorAccess } = require('./spectatorAccess');
const { registerSocketHandlers } = require('./socketHandlers');

const privateAccess = createPrivateAccessPolicy({
  io,
  turnService,
  MODES,
  getMode,
  isAdmin,
  isLockdownAdmin,
  normalizePrivateSafety,
  DEFAULT_PRIVATE_SAFETY,
});

const {
  parsePrivateMeta,
  isPrivateRecord,
  isPrivateOpen,
  getPrivateSafety,
  shouldApplyPrivateSafety,
  shouldApplyPrivateSensorSafety,
  isRoverVisibleToSocket,
  getControlDenialReason,
} = privateAccess;

const roverLifecycle = createRoverLifecycle({
  rovers,
  socketToRovers,
  managerEvents,
  turnService,
  isAdmin,
  sendAlert,
  ALERT_COLOR,
  getMode,
  getControlDenialReason,
});

const {
  requestControl,
  releaseControl,
  isDriver,
  canDrive,
  getRoversForSocket,
  getPrimaryRoverForSocket,
  canSwitchRover,
} = roverLifecycle;

let stopDockGuard = () => {};

const rosterLifecycle = createRosterLifecycle({
  io,
  logger,
  sendAlert,
  publishEvent,
  turnService,
  ALERT_COLOR,
  DEFAULT_PRIVATE_SAFETY,
  rovers,
  spectatorSockets,
  managerEvents,
  privateButtonStates,
  privateNoUsersSince,
  privateSafetyTimers,
  privateSafetyStates,
  parsePrivateMeta,
  isPrivateRecord,
  isPrivateOpen,
  getPrivateSafety,
  isRoverVisibleToSocket,
  normalizePrivateSafety,
  stopDockGuard: (...args) => stopDockGuard(...args),
  getControlDenialReason,
});

const {
  upsertRover,
  removeRover,
  lockRover,
  setPrivateOpen,
  setPrivateSafety,
  getRoster,
  getRosterForSocket,
  broadcastRoster,
  setNightVisionState,
  canSeeRover,
  canRequestControl,
} = rosterLifecycle;

const spectatorAccess = createSpectatorAccess({
  io,
  logger,
  rovers,
  spectatorSockets,
  privateNoUsersSince,
  PRIVATE_AUTO_CLOSE_IDLE_MS,
  isPrivateRecord,
  isPrivateOpen,
  isRoverVisibleToSocket,
  setPrivateOpen,
});

const { enableSpectator, disableSpectator, tickPrivateAutoClose } = spectatorAccess;

const sensorPipeline = createSensorPipeline({
  io,
  logger,
  rovers,
  managerEvents,
  dockGuardStates,
  backoffTimers,
  privateButtonStates,
  privateSafetyTimers,
  privateSafetyStates,
  parseSensorFrame,
  computeBatteryState,
  clampInt,
  DEFAULT_PRIVATE_SAFETY,
  SAFETY_BACKOFF_MIN,
  SAFETY_BACKOFF_MAX,
  PRIVATE_BUTTON_HOLD_MS,
  IDLE_UNDOCKED_MS,
  PASSIVE_UNDOCKED_MS,
  DOCK_GUARD_RETRY_MS,
  DOCK_GUARD_WINDOW_MS,
  DOCK_COMMAND_BASE64,
  BACKOFF_MS,
  BACKOFF_SPEED,
  ALERT_COLOR,
  sendAlert,
  publishEvent,
  isPrivateRecord,
  isPrivateOpen,
  getPrivateSafety,
  setPrivateOpen,
  shouldApplyPrivateSafety,
  shouldApplyPrivateSensorSafety,
});

const { handleSensorFrame, applyPrivateDriveSafety } = sensorPipeline;
stopDockGuard = sensorPipeline.stopDockGuard;

function removeSocket(socket) {
  roverLifecycle.removeSocket(socket, disableSpectator);
}

function canReplayRoverId(roverId) {
  return roverLifecycle.canReplayRoverId(roverId, isPrivateRecord, isPrivateOpen);
}

roleEvents.on('change', ({ socket, role }) => {
  if (role === 'spectator') {
    enableSpectator(socket);
  } else {
    disableSpectator(socket);
  }
});

registerSocketHandlers({
  io,
  logger,
  MODES,
  ALERT_COLOR,
  getMode,
  isAdmin,
  isLockdownAdmin,
  sendAlert,
  videoSessions,
  rovers,
  isPrivateRecord,
  isRoverVisibleToSocket,
  tickPrivateAutoClose,
  removeSocket,
  enableSpectator,
  canRequestControl,
  canSwitchRover,
  getRoversForSocket,
  requestControl,
  releaseControl,
  managerEvents,
  setPrivateOpen,
  lockRover,
  setPrivateSafety,
});

setInterval(tickPrivateAutoClose, PRIVATE_AUTO_CLOSE_TICK_MS);

module.exports = {
  upsertRover,
  removeRover,
  lockRover,
  setPrivateOpen,
  setPrivateSafety,
  getRoster,
  getRosterForSocket,
  broadcastRoster,
  setNightVisionState,
  handleSensorFrame,
  requestControl,
  releaseControl,
  removeSocket,
  isDriver,
  canDrive,
  enableSpectator,
  disableSpectator,
  rovers,
  managerEvents,
  getRoversForSocket,
  getPrimaryRoverForSocket,
  canSeeRover,
  canRequestControl,
  applyPrivateDriveSafety,
  canReplayRoverId,
};
