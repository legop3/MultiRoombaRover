// health Service
// Purpose: Defines the health Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fsp = require('fs/promises');
const path = require('path');
const roverManager = require('../roverManager');
const { getRoomCameras } = require('../roomCameraService');
const { getRoomCameraState } = require('../roomCameraService');
const { getReplayHealthSnapshot } = require('../replayEngineV2');

const SNAPSHOT_DIR = path.resolve(__dirname, '..', '..', 'data', 'rover-snapshots');
const HEALTH_INTERVAL_MS = 5000;
const ROOM_CAMERA_STALE_MS = 5000;
const ROVER_SNAPSHOT_STALE_MS = 5000;

let latest = {
  updatedAt: Date.now(),
  replay: { sources: [], readyCount: 0, totalCount: 0 },
  snapshots: { rovers: [], rooms: [] },
};

function collectReplayHealth() {
  return getReplayHealthSnapshot();
}

async function collectSnapshotHealth(now) {
  const rovers = roverManager.getRoster().map((rover) => ({
    id: String(rover.id),
    name: rover.name || rover.id,
  }));
  const roverSnapshots = [];
  for (const rover of rovers) {
    const filePath = path.join(SNAPSHOT_DIR, `${rover.id}.jpg`);
    let exists = false;
    let size = 0;
    let updatedAt = null;
    try {
      const stat = await fsp.stat(filePath);
      exists = true;
      size = stat.size;
      updatedAt = stat.mtimeMs;
    } catch {
      // missing snapshot
    }
    const ageMs = updatedAt ? now - updatedAt : null;
    const stale = ageMs != null ? ageMs > ROVER_SNAPSHOT_STALE_MS : true;
    roverSnapshots.push({
      id: rover.id,
      name: rover.name,
      exists,
      size,
      updatedAt,
      ageMs,
      stale,
    });
  }

  const roomSnapshots = getRoomCameras().map((camera) => {
    const state = getRoomCameraState(camera.id);
    const updatedAt = state?.ts || null;
    const ageMs = updatedAt ? now - updatedAt : null;
    const stale = ageMs != null ? ageMs > ROOM_CAMERA_STALE_MS : true;
    return {
      id: camera.id,
      name: camera.name || camera.id,
      updatedAt,
      ageMs,
      error: state?.error || null,
      stale,
    };
  });

  return { rovers: roverSnapshots, rooms: roomSnapshots };
}

async function refreshHealth() {
  const now = Date.now();
  const replay = collectReplayHealth(now);
  const snapshots = await collectSnapshotHealth(now);
  latest = { updatedAt: now, replay, snapshots };
}

refreshHealth();
setInterval(refreshHealth, HEALTH_INTERVAL_MS);

function getHealthSnapshot() {
  return latest;
}

module.exports = {
  getHealthSnapshot,
};
