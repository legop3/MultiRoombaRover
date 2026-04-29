// Rover Snapshot Poller
// Purpose: Polls on-disk rover snapshot images and emits frame/status updates as rover files change.
// Scope: Owns snapshot file IO, stale-rover cleanup, and in-memory state tracking.
const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const logger = require('../../globals/logger').child('roverSnapshot');

const SNAPSHOT_DIR = process.env.ROVER_SNAPSHOT_DIR || '/var/lib/rover-snapshots';
const POLL_INTERVAL_MS = 300;
const FORCE_REREAD_STALE_MS = 2000;
const STALE_WARN_MS = 10000;

const roverState = new Map();
const events = new EventEmitter();
let pollTimer = null;

function markState(id, updates = {}) {
  const prev = roverState.get(id) || {};
  const next = { ...prev, ...updates };
  roverState.set(id, next);
  return next;
}

function getSnapshotPath(id) {
  return path.join(SNAPSHOT_DIR, `${id}.jpg`);
}

function createRoverSnapshotPoller({ roverManager }) {
  async function fetchSnapshot(id) {
    const prev = roverState.get(id);
    if (prev?.fetching) return;
    markState(id, { fetching: true });
    try {
      const filePath = getSnapshotPath(id);
      const stats = await fs.stat(filePath);
      const now = Date.now();
      const staleAgeMs = prev?.ts ? now - prev.ts : 0;
      const mtimeUnchanged = Boolean(prev?.mtimeMs && stats.mtimeMs <= prev.mtimeMs);
      const shouldForceRead = mtimeUnchanged && staleAgeMs >= FORCE_REREAD_STALE_MS;
      if (mtimeUnchanged && !shouldForceRead) return;

      const buffer = await fs.readFile(filePath);
      const ts = stats.mtimeMs || now;
      const prevFrame = prev?.frame || null;
      const changed =
        !prevFrame ||
        prevFrame.length !== buffer.length ||
        !prevFrame.equals(buffer) ||
        !mtimeUnchanged;
      const nextState = markState(id, {
        frame: changed ? buffer : prevFrame,
        ts: changed ? ts : prev?.ts || ts,
        error: null,
        failures: 0,
        mtimeMs: stats.mtimeMs,
      });
      if (changed) {
        events.emit('frame', { id, buffer, ts: nextState.ts });
      } else if (staleAgeMs >= STALE_WARN_MS) {
        logger.warn('Snapshot appears stale', {
          id,
          snapshotDir: SNAPSHOT_DIR,
          path: filePath,
          ageMs: staleAgeMs,
          mtimeMs: stats.mtimeMs,
        });
      }
    } catch (err) {
      const failures = (prev?.failures || 0) + 1;
      const message = err.code === 'ENOENT' ? 'Snapshot missing' : err.message;
      markState(id, { error: message, failures });
      events.emit('status', { id, error: message });
      if (failures % 20 === 1) logger.warn('Snapshot read failed', { id, err: message });
    } finally {
      markState(id, { fetching: false });
    }
  }

  function cleanupInactive(activeIds) {
    roverState.forEach((_, id) => {
      if (!activeIds.has(id)) roverState.delete(id);
    });
  }

  function stopAll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    roverState.clear();
  }

  function startAll() {
    stopAll();
    logger.info('Starting rover snapshot polling', {
      snapshotDir: SNAPSHOT_DIR,
      intervalMs: POLL_INTERVAL_MS,
      forceRereadStaleMs: FORCE_REREAD_STALE_MS,
    });
    pollTimer = setInterval(() => {
      const roster = roverManager.getRoster();
      const activeIds = new Set(roster.map((entry) => String(entry.id)));
      cleanupInactive(activeIds);
      roster.forEach((entry) => fetchSnapshot(String(entry.id)));
    }, POLL_INTERVAL_MS);
    logger.info('Started rover snapshot polling');
  }

  function getRoverSnapshotState(id) {
    const state = roverState.get(id);
    if (!state) return null;
    return {
      frame: state.frame || null,
      ts: state.ts || null,
      error: state.error || null,
    };
  }

  return {
    startAll,
    stopAll,
    roverSnapshotEvents: events,
    getRoverSnapshotState,
  };
}

module.exports = {
  createRoverSnapshotPoller,
};
