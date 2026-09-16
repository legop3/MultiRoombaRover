// Room Camera Service
// Purpose: Composes room camera catalog, snapshot streaming, socket delivery, and replay helpers in one service folder.
// Scope: Exposes the existing room-camera public API while preserving side-effect startup behavior.
const { loadFromConfig, getRoomCameras, getRoomCamera, roomCameraEvents } = require('./catalog');
const { createSnapshotEngine } = require('./snapshotEngine');
const { registerRoomCameraSocketGateway } = require('./socketGateway');
const replay = require('../replayEngineV2/roomCameraReplayBuilder');
const { loadConfig, registerConfigurationHandler } = require('../../configuration');

let enabled = false;

const snapshotEngine = createSnapshotEngine({ getRoomCameras, roomCameraEvents });
function applyRoomCameraConfig(roomCameraConfig = {}) {
  enabled = Boolean(roomCameraConfig.enabled);
  // Loading an empty catalog on disable causes the snapshot engine's existing
  // update listener to close every stream and timer without unregistering the
  // stable browser gateway.
  loadFromConfig(enabled ? roomCameraConfig : { cameras: [] });
}

registerRoomCameraSocketGateway({
  getRoomCamera,
  getRoomCameras,
  getRoomCameraState: snapshotEngine.getRoomCameraState,
  roomCameraStreamEvents: snapshotEngine.roomCameraStreamEvents,
});

applyRoomCameraConfig(loadConfig().roomCameras || {});
registerConfigurationHandler('roomCameras', applyRoomCameraConfig);

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
