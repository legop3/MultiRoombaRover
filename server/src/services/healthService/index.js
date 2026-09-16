// health Service
// Purpose: Defines the health Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const { resolveDataDir, resolveRoverSnapshotDir } = require('../../helpers/dataPaths');
const roverManager = require('../roverManager');
const { getRoomCameras } = require('../roomCameraService');
const { getRoomCameraState } = require('../roomCameraService');
const { getReplayHealthSnapshot } = require('../replayEngineV2');

const ROVER_SNAPSHOT_DIR = resolveRoverSnapshotDir();
const HEALTH_INTERVAL_MS = 5000;
const ROOM_CAMERA_STALE_MS = 5000;
const ROVER_SNAPSHOT_STALE_MS = 5000;
const MEDIAMTX_HEALTH_URL = 'http://127.0.0.1:9998/metrics';
const MEDIAMTX_HEALTH_TIMEOUT_MS = 1500;

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
  const replay = collectReplayHealth(now);
  const snapshots = await collectSnapshotHealth(now);
  latest = { updatedAt: now, replay, snapshots };
}

refreshHealth();
setInterval(refreshHealth, HEALTH_INTERVAL_MS);

function getHealthSnapshot() {
  return latest;
}

async function getContainerHealth() {
  let dataDirectory = false;
  let mediaMtx = false;

  try {
    /*
      The mounted data root is the container's only persistent storage. Check
      the directory itself instead of creating a probe file on every request;
      this proves that the running application user can reach the mount without
      adding health-check writes to backups or administrative file listings.
    */
    await fsp.access(resolveDataDir(), fs.constants.R_OK | fs.constants.W_OK);
    dataDirectory = true;
  } catch {
    dataDirectory = false;
  }

  try {
    /*
      MediaMTX already exposes metrics only on loopback, so it is also the
      smallest reliable readiness probe. Reading the response closes the body
      before this request completes and avoids accumulating idle connections
      across Docker's recurring health checks.
    */
    const response = await fetch(MEDIAMTX_HEALTH_URL, {
      signal: AbortSignal.timeout(MEDIAMTX_HEALTH_TIMEOUT_MS),
    });
    await response.text();
    mediaMtx = response.ok;
  } catch {
    mediaMtx = false;
  }

  return {
    healthy: dataDirectory && mediaMtx,
    checks: {
      dataDirectory,
      mediaMtx,
    },
  };
}

module.exports = {
  getContainerHealth,
  getHealthSnapshot,
};
