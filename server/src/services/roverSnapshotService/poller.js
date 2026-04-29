// Rover Snapshot Poller
// Purpose: Polls on-disk rover snapshot images and emits frame/status updates as rover files change.
// Scope: Owns snapshot file IO, stale-rover cleanup, and in-memory state tracking.
const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const logger = require('../../globals/logger').child('roverSnapshot');

const SNAPSHOT_DIR = path.resolve(__dirname, '..', '..', 'data', 'rover-snapshots');
const POLL_INTERVAL_MS = 300;
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
    const state = roverState.get(id);
    if (state?.fetching) return;
    markState(id, { fetching: true });
    try {
      const filePath = getSnapshotPath(id);
      const stats = await fs.stat(filePath);
      if (state?.mtimeMs && stats.mtimeMs <= state.mtimeMs) return;
      const buffer = await fs.readFile(filePath);
      const ts = stats.mtimeMs || Date.now();
      markState(id, { frame: buffer, ts, error: null, failures: 0, mtimeMs: stats.mtimeMs });
      events.emit('frame', { id, buffer, ts });
      return { frame: buffer, ts };
    } catch (err) {
      const failures = (state?.failures || 0) + 1;
      const message = err.code === 'ENOENT' ? 'Snapshot missing' : err.message;
      markState(id, { error: message, failures });
      events.emit('status', { id, error: message });
      if (failures % 20 === 1) logger.warn('Snapshot read failed', { id, err: message });
      return null;
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
