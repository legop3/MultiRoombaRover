// Kinect Socket Gateway
// Purpose: Registers browser-facing Kinect snapshot controls and broadcasts shared Kinect frames over Socket.IO.
// Scope: Owns authorization, global capture cooldown, request serialization, cached-frame replay, and session-status events.
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('kinectService');
const { getMode, MODES } = require('../modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('../roleService');

const DEFAULT_CAPTURE_COOLDOWN_MS = 10000;

const kinectEvents = new EventEmitter();

function passesMode(socket) {
  const mode = getMode();
  if (mode === MODES.LOCKDOWN) return isLockdownAdmin(socket);
  if (mode === MODES.ADMIN) {
    const role = getRole(socket);
    return role === 'spectator' || isAdmin(socket);
  }
  return true;
}

function normalizeKinectConfig(config = {}) {
  const raw = config.kinect || {};
  return {
    enabled: Boolean(raw.enabled),
    captureCooldownMs:
      Number.isFinite(Number(raw.captureCooldownMs)) && Number(raw.captureCooldownMs) >= 0
        ? Number(raw.captureCooldownMs)
        : DEFAULT_CAPTURE_COOLDOWN_MS,
  };
}

function registerKinectSocketGateway({ config, hardware }) {
  const settings = normalizeKinectConfig(config);
  let captureCooldownUntil = 0;
  let busy = false;
  let lastAction = null;
  let lastError = null;
  let lastPointCloud = null;
  let lastColorImage = null;

  function buildStatus(extra = {}) {
    return {
      enabled: settings.enabled,
      // Availability starts optimistic when enabled.  A real worker/capture
      // failure changes lastError, and session sync then makes the UI show that
      // the camera path needs attention.
      available: settings.enabled && !lastError,
      busy,
      captureCooldownUntil,
      lastAction,
      lastError,
      hasPointCloud: Boolean(lastPointCloud?.buffer),
      hasColorImage: Boolean(lastColorImage?.buffer),
      lastPointCloudTs: lastPointCloud?.meta?.ts || null,
      lastColorImageTs: lastColorImage?.meta?.ts || null,
      ...extra,
    };
  }

  function emitStatusChange(extra = {}) {
    // The browser already receives session-wide status through sessionService.
    // Emitting a local service event keeps Kinect-specific code from importing
    // sessionService directly and creating a require cycle.
    kinectEvents.emit('change', buildStatus(extra));
  }

  function sendCachedFrames(socket) {
    // Cached-frame replay gives newly opened tabs the latest room snapshot
    // without starting a new Kinect capture or spending upload continuously.
    if (lastPointCloud?.buffer) {
      socket.emit('kinect:pointCloudFrame', lastPointCloud.meta, lastPointCloud.buffer);
    }
    if (lastColorImage?.buffer) {
      socket.emit('kinect:colorFrame', lastColorImage.meta, lastColorImage.buffer);
    }
  }

  function rejectDisabled() {
    if (!settings.enabled) {
      return { error: 'kinect service is disabled' };
    }
    return null;
  }

  function rejectUnauthorized(socket) {
    if (!passesMode(socket)) {
      return { error: 'not authorized for kinect controls' };
    }
    return null;
  }

  function rejectCaptureCooldown() {
    const now = Date.now();
    if (captureCooldownUntil > now) {
      return {
        error: 'kinect capture cooldown active',
        retryAfterMs: captureCooldownUntil - now,
        captureCooldownUntil,
      };
    }
    return null;
  }

  async function handleCapture(socket, kind, cb) {
    const disabled = rejectDisabled();
    const unauthorized = rejectUnauthorized(socket);
    const cooldown = rejectCaptureCooldown();
    if (disabled || unauthorized || cooldown) {
      const response = disabled || unauthorized || cooldown;
      cb(response);
      emitStatusChange();
      return;
    }

    if (busy) {
      cb({ error: 'kinect capture already running' });
      emitStatusChange();
      return;
    }

    busy = true;
    lastAction = kind;
    lastError = null;
    // The cooldown starts when the server accepts the request.  That makes every
    // connected browser disable capture controls immediately, instead of waiting
    // for the worker to finish serializing a multi-megabyte point cloud.
    captureCooldownUntil = Date.now() + settings.captureCooldownMs;
    cb({ ok: true, captureCooldownUntil });
    emitStatusChange();

    try {
      const capture =
        kind === 'pointCloud'
          ? await hardware.capturePointCloud()
          : await hardware.captureColorImage();
      const meta = {
        ...capture.meta,
        ts: Date.now(),
        requestedBy: socket.id,
      };
      if (kind === 'pointCloud') {
        lastPointCloud = { meta, buffer: capture.buffer };
        io.emit('kinect:pointCloudFrame', meta, capture.buffer);
      } else {
        lastColorImage = { meta, buffer: capture.buffer };
        io.emit('kinect:colorFrame', meta, capture.buffer);
      }
      logger.info('Kinect capture broadcast', {
        kind,
        bytes: capture.buffer?.length || capture.buffer?.byteLength || 0,
        socketId: socket.id,
      });
    } catch (err) {
      lastError = err.message || 'kinect capture failed';
      logger.warn('Kinect capture failed', { kind, socketId: socket.id, err: lastError });
    } finally {
      busy = false;
      emitStatusChange();
    }
  }

  io.on('connection', (socket) => {
    sendCachedFrames(socket);

    socket.on('kinect:requestCachedFrames', (_payload = {}, cb = () => {}) => {
      sendCachedFrames(socket);
      cb({ ok: true });
    });

    socket.on('kinect:requestPointCloud', (_payload = {}, cb = () => {}) => {
      handleCapture(socket, 'pointCloud', cb);
    });

    socket.on('kinect:requestColorImage', (_payload = {}, cb = () => {}) => {
      handleCapture(socket, 'colorImage', cb);
    });
  });

  if (settings.enabled) {
    try {
      // Starting the worker at service startup gives the callback path time to
      // warm up, while clients still control when bytes are uploaded to them.
      hardware.startWorker();
    } catch (err) {
      lastError = err.message || 'kinect worker failed to start';
      logger.warn('Kinect worker startup failed', { err: lastError });
    }
  }

  return {
    getState: buildStatus,
  };
}

module.exports = {
  registerKinectSocketGateway,
  kinectEvents,
};
