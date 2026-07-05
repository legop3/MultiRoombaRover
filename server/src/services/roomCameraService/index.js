// Room Camera Service
// Purpose: Composes room camera catalog, snapshot streaming, socket delivery, and replay helpers in one service folder.
// Scope: Exposes the existing room-camera public API while preserving side-effect startup behavior.
const { loadFromConfig, getRoomCameras, getRoomCamera, roomCameraEvents } = require('./catalog');
const { createSnapshotEngine } = require('./snapshotEngine');
const { registerRoomCameraSocketGateway } = require('./socketGateway');
const replay = require('../replayEngineV2/roomCameraReplayBuilder');
const { isFeatureEnabled } = require('../../helpers/features');

const enabled = isFeatureEnabled('roomCameras');

const snapshotEngine = createSnapshotEngine({ getRoomCameras, roomCameraEvents });
if (enabled) {
  /*
    Room cameras are optional local hardware/network devices. The service module
    can still be imported by replay, health, and session code, but disabled
    installs must not start polling LAN cameras in the background.
  */
  loadFromConfig();
  snapshotEngine.startAll();
}

if (enabled) {
  /*
    Camera frame sockets are part of the room-camera feature surface. Keeping
    them behind the same gate prevents disabled features from being callable by
    hand even though server/index.js still imports this module.
  */
  registerRoomCameraSocketGateway({
    getRoomCamera,
    getRoomCameras,
    getRoomCameraState: snapshotEngine.getRoomCameraState,
    roomCameraStreamEvents: snapshotEngine.roomCameraStreamEvents,
  });
}

function buildRoomCameraReplayVideo(options = {}) {
  return replay.buildRoomCameraReplayVideo(options, { getRoomCamera, getRoomCameras });
}

module.exports = {
  getRoomCameras,
  getRoomCamera,
  roomCameraEvents,
  roomCameraStreamEvents: snapshotEngine.roomCameraStreamEvents,
  getRoomCameraState: snapshotEngine.getRoomCameraState,
  recordRoomCameraFrame: replay.recordRoomCameraFrame,
  clearRoomCameraReplayFrames: replay.clearRoomCameraReplayFrames,
  getRoomCameraReplayMetadata: replay.getRoomCameraReplayMetadata,
  buildRoomCameraReplayVideo,
  roomCameraReplayEvents: replay.roomCameraReplayEvents,
};
