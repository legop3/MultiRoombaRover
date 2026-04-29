// Room Camera Service
// Purpose: Composes room camera catalog, snapshot streaming, socket delivery, and replay helpers in one service folder.
// Scope: Exposes the existing room-camera public API while preserving side-effect startup behavior.
const { loadFromConfig, getRoomCameras, getRoomCamera, roomCameraEvents } = require('./catalog');
const { createSnapshotEngine } = require('./snapshotEngine');
const { registerRoomCameraSocketGateway } = require('./socketGateway');
const replay = require('../replayEngineV2/roomCameraReplayBuilder');

const snapshotEngine = createSnapshotEngine({ getRoomCameras, roomCameraEvents });
snapshotEngine.startAll();

registerRoomCameraSocketGateway({
  getRoomCamera,
  getRoomCameras,
  getRoomCameraState: snapshotEngine.getRoomCameraState,
  roomCameraStreamEvents: snapshotEngine.roomCameraStreamEvents,
});

loadFromConfig();

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
