const EventEmitter = require('events');
const http = require('http');
const https = require('https');
const logger = require('../globals/logger').child('roomCameraSnapshot');
const { getRoomCameras, roomCameraEvents } = require('./roomCameraService');

const POLL_INTERVAL_MS = 67;
const FETCH_TIMEOUT_MS = 2000;
const STREAM_RETRY_MS = 1500;

const cameraState = new Map(); // id -> {frame, ts, error, failures, fetching}
const events = new EventEmitter(); // frame, status
let pollTimer = null;
const streamState = new Map(); // id -> { req, reconnectTimer }

function markState(id, updates = {}) {
  const prev = cameraState.get(id) || {};
  const next = { ...prev, ...updates };
  cameraState.set(id, next);
  return next;
}

function isMjpegUrl(rawUrl) {
  if (!rawUrl) return false;
  const lower = String(rawUrl).toLowerCase();
  return lower.endsWith('.mjpg') || lower.endsWith('.mjpeg') || lower.includes('mjpeg');
}

function getStreamUrl(camera) {
  if (camera.streamUrl) return camera.streamUrl;
  if (isMjpegUrl(camera.url)) return camera.url;
  return null;
}

function stopStream(id) {
  const entry = streamState.get(id);
  if (!entry) return;
  if (entry.req) {
    entry.req.destroy();
  }
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
  }
  streamState.delete(id);
}

function scheduleStreamReconnect(camera) {
  const id = camera.id;
  const entry = streamState.get(id) || {};
  if (entry.reconnectTimer) return;
  entry.reconnectTimer = setTimeout(() => {
    const current = streamState.get(id) || {};
    current.reconnectTimer = null;
    streamState.set(id, current);
    startStream(camera);
  }, STREAM_RETRY_MS);
  streamState.set(id, entry);
}

function handleStreamError(camera, err) {
  const state = cameraState.get(camera.id) || {};
  const failures = (state.failures || 0) + 1;
  markState(camera.id, { error: err.message || 'stream error', failures });
  events.emit('status', { id: camera.id, error: err.message || 'stream error' });
  logger.warn('Stream failed', { id: camera.id, err: err.message });
}

function startStream(camera) {
  const streamUrl = getStreamUrl(camera);
  if (!streamUrl) return;
  if (streamState.get(camera.id)?.req) return;
  const url = new URL(streamUrl);
  const client = url.protocol === 'https:' ? https : http;
  const req = client.get(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: { Accept: 'multipart/x-mixed-replace' },
    },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        handleStreamError(camera, new Error(`HTTP ${res.statusCode}`));
        scheduleStreamReconnect(camera);
        return;
      }
      let buffer = Buffer.alloc(0);
      res.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const start = buffer.indexOf(0xffd8);
          if (start === -1) {
            if (buffer.length > 2 * 1024 * 1024) {
              buffer = buffer.slice(-1024 * 1024);
            }
            break;
          }
          const end = buffer.indexOf(0xffd9, start + 2);
          if (end === -1) break;
          const frame = buffer.slice(start, end + 2);
          buffer = buffer.slice(end + 2);
          const ts = Date.now();
          markState(camera.id, { frame, ts, error: null, failures: 0 });
          events.emit('frame', { id: camera.id, buffer: frame, ts });
        }
      });
      res.on('end', () => {
        scheduleStreamReconnect(camera);
      });
      res.on('error', (err) => {
        handleStreamError(camera, err);
        scheduleStreamReconnect(camera);
      });
    },
  );
  req.on('error', (err) => {
    handleStreamError(camera, err);
    scheduleStreamReconnect(camera);
  });
  streamState.set(camera.id, { req, reconnectTimer: null });
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
  Array.from(streamState.keys()).forEach((id) => stopStream(id));
  cameraState.clear();
}

function startAll() {
  stopAll();
  const cameras = getRoomCameras();
  const snapshotCameras = cameras.filter((camera) => !getStreamUrl(camera) && camera.url);
  cameras.forEach((camera) => startStream(camera));
  if (snapshotCameras.length) {
    pollTimer = setInterval(() => {
      snapshotCameras.forEach((camera) => fetchSnapshot(camera));
    }, POLL_INTERVAL_MS);
    snapshotCameras.forEach((camera) => fetchSnapshot(camera));
  }
  logger.info('Started room camera feeds', {
    total: cameras.length,
    streaming: cameras.length - snapshotCameras.length,
    snapshots: snapshotCameras.length,
  });
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

roomCameraEvents.on('update', () => {
  logger.info('Room cameras changed; restarting snapshot pollers');
  startAll();
});

startAll();

module.exports = {
  roomCameraStreamEvents: events,
  getRoomCameraState: getState,
};
