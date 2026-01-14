const fsp = require('fs/promises');
const path = require('path');
const roverManager = require('./roverManager');
const { getRoomCameras } = require('./roomCameraService');
const { getRoomCameraState } = require('./roomCameraSnapshotService');
const { getReplaySources } = require('./replaySourceService');
const { replaySegmentsDir, segmentSeconds, bufferSeconds } = require('./replaySegmentManager');

const ROVER_SNAPSHOT_DIR = process.env.ROVER_SNAPSHOT_DIR || '/var/lib/rover-snapshots';
const HEALTH_INTERVAL_MS = 5000;
const ROOM_CAMERA_STALE_MS = 5000;
const ROVER_SNAPSHOT_STALE_MS = 5000;

let latest = {
  updatedAt: Date.now(),
  replay: { sources: [], readyCount: 0, totalCount: 0 },
  snapshots: { rovers: [], rooms: [] },
};

async function collectReplayHealth(now) {
  const neededCount = Math.max(1, Math.ceil(20000 / (segmentSeconds * 1000)));
  const sources = getReplaySources();
  const list = [];
  let readyCount = 0;
  for (const source of sources) {
    const key = `${source.type}__${source.id}`;
    const dir = path.join(replaySegmentsDir, key);
    let lastSegmentAt = null;
    let recentCount = 0;
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.mp4')) continue;
        const stat = await fsp.stat(path.join(dir, entry.name));
        if (stat.mtimeMs > (lastSegmentAt || 0)) {
          lastSegmentAt = stat.mtimeMs;
        }
        if (now - stat.mtimeMs <= bufferSeconds * 1000) {
          recentCount += 1;
        }
      }
    } catch {
      // directory missing or unreadable
    }
    const ready = recentCount >= neededCount;
    if (ready) readyCount += 1;
    list.push({
      type: source.type,
      id: source.id,
      label: source.label || `${source.type}:${source.id}`,
      recentCount,
      neededCount,
      lastSegmentAt,
      ready,
    });
  }
  return { sources: list, readyCount, totalCount: list.length };
}

async function collectSnapshotHealth(now) {
  const rovers = roverManager.getRoster().map((rover) => ({
    id: String(rover.id),
    name: rover.name || rover.id,
  }));
  const roverSnapshots = [];
  for (const rover of rovers) {
    const filePath = path.join(ROVER_SNAPSHOT_DIR, `${rover.id}.jpg`);
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
  const replay = await collectReplayHealth(now);
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
