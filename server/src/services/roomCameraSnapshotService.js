const EventEmitter = require('events');
const logger = require('../globals/logger').child('roomCameraSnapshot');
const { getRoomCameras, roomCameraEvents } = require('./roomCameraService');

const POLL_INTERVAL_MS = 800;
const FETCH_TIMEOUT_MS = 2000;
const STALE_AFTER_MS = 8000;

const cameraState = new Map(); // id -> {frame, ts, stale, error, failures, fetching}
const events = new EventEmitter(); // frame, status
let pollTimer = null;

function markState(id, updates = {}) {
  const prev = cameraState.get(id) || {};
  const next = { ...prev, ...updates };
  if (next.ts != null) {
    next.stale = Date.now() - next.ts > STALE_AFTER_MS || !!next.stale;
  } else {
    next.stale = true;
  }
  cameraState.set(id, next);
  return next;
}

async function fetchSnapshot(camera) {
  const { id, url } = camera;
  const state = cameraState.get(id);
  if (!url || state?.fetching) return;
  markState(id, { fetching: true });
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: abortController.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ts = Date.now();
    const next = markState(id, { frame: buffer, ts, error: null, failures: 0 });
    events.emit('frame', { id, buffer, ts, stale: !!next.stale });
  } catch (err) {
    const failures = (state?.failures || 0) + 1;
    markState(id, { error: err.message, failures });
    events.emit('status', { id, error: err.message });
    logger.warn('Snapshot fetch failed', { id, err: err.message });
  } finally {
    clearTimeout(timeout);
    markState(id, { fetching: false });
  }
}

function stopAll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  cameraState.clear();
}

function startAll() {
  stopAll();
  pollTimer = setInterval(() => {
    getRoomCameras().forEach((camera) => fetchSnapshot(camera));
  }, POLL_INTERVAL_MS);
  getRoomCameras().forEach((camera) => fetchSnapshot(camera));
  logger.info('Started snapshot polling', { count: getRoomCameras().length });
}

function getState(id) {
  const state = cameraState.get(id);
  if (!state) return null;
  const stale = state.ts == null || Date.now() - state.ts > STALE_AFTER_MS;
  return {
    frame: state.frame || null,
    ts: state.ts || null,
    stale,
    error: state.error || null,
  };
}

roomCameraEvents.on('update', () => {
  logger.info('Room cameras changed; restarting snapshot pollers');
  startAll();
});

startAll();

module.exports = {
  roomCameraStreamEvents: events,
  getRoomCameraState: getState,
};
