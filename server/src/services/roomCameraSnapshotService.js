const EventEmitter = require('events');
const logger = require('../globals/logger').child('roomCameraSnapshot');
const { getRoomCameras, roomCameraEvents } = require('./roomCameraService');

const POLL_INTERVAL_MS = 800;
const REPLAY_FRAME_COUNT = 15;
const FETCH_TIMEOUT_MS = 2000;

const cameraState = new Map(); // id -> {frame, ts, error, failures, fetching}
const frameHistory = new Map(); // id -> [{buffer, ts}]
const events = new EventEmitter(); // frame, status
let pollTimer = null;

function markState(id, updates = {}) {
  const prev = cameraState.get(id) || {};
  const next = { ...prev, ...updates };
  cameraState.set(id, next);
  return next;
}

function recordFrame(id, buffer, ts) {
  const history = frameHistory.get(id) || [];
  history.push({ buffer, ts });
  if (history.length > REPLAY_FRAME_COUNT) {
    history.splice(0, history.length - REPLAY_FRAME_COUNT);
  }
  frameHistory.set(id, history);
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
    markState(id, { frame: buffer, ts, error: null, failures: 0 });
    recordFrame(id, buffer, ts);
    events.emit('frame', { id, buffer, ts });
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
  frameHistory.clear();
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
  return {
    frame: state.frame || null,
    ts: state.ts || null,
    error: state.error || null,
  };
}

function getReplayFrames(id, count = REPLAY_FRAME_COUNT) {
  const history = frameHistory.get(id) || [];
  if (!history.length) return [];
  return history.slice(Math.max(0, history.length - count));
}

function getReplayFrameDelayMs() {
  return POLL_INTERVAL_MS;
}

function getReplayFrameCount() {
  return REPLAY_FRAME_COUNT;
}

roomCameraEvents.on('update', () => {
  logger.info('Room cameras changed; restarting snapshot pollers');
  startAll();
});

startAll();

module.exports = {
  roomCameraStreamEvents: events,
  getRoomCameraState: getState,
  getRoomCameraFrames: getReplayFrames,
  getRoomCameraReplayDelayMs: getReplayFrameDelayMs,
  getRoomCameraReplayFrameCount: getReplayFrameCount,
};
