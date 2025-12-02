const io = require('../globals/io');
const logger = require('../globals/logger').child('roomCameraSocket');
const { getMode, MODES } = require('./modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('./roleService');
const { getRoomCamera } = require('./roomCameraService');
const { roomCameraStreamEvents, getRoomCameraState } = require('./roomCameraSnapshotService');

function passesMode(socket) {
  const mode = getMode();
  if (mode === MODES.LOCKDOWN) {
    return isLockdownAdmin(socket);
  }
  if (mode === MODES.ADMIN) {
    const role = getRole(socket);
    return role === 'spectator' || isAdmin(socket);
  }
  return true;
}

function canViewRoomCamera(socket) {
  return passesMode(socket);
}

const cameraSubscribers = new Map(); // id -> Set(socketId)
const socketSubscriptions = new Map(); // socketId -> Set(id)

function addSubscription(socket, cameraId) {
  if (!cameraSubscribers.has(cameraId)) {
    cameraSubscribers.set(cameraId, new Set());
  }
  cameraSubscribers.get(cameraId).add(socket.id);

  if (!socketSubscriptions.has(socket.id)) {
    socketSubscriptions.set(socket.id, new Set());
  }
  socketSubscriptions.get(socket.id).add(cameraId);
}

function removeSubscription(socketId, cameraId) {
  const bucket = cameraSubscribers.get(cameraId);
  if (bucket) {
    bucket.delete(socketId);
    if (bucket.size === 0) {
      cameraSubscribers.delete(cameraId);
    }
  }
  const socketBucket = socketSubscriptions.get(socketId);
  if (socketBucket) {
    socketBucket.delete(cameraId);
    if (socketBucket.size === 0) {
      socketSubscriptions.delete(socketId);
    }
  }
}

function removeAllSubscriptions(socketId) {
  const bucket = socketSubscriptions.get(socketId);
  if (!bucket) return;
  bucket.forEach((cameraId) => removeSubscription(socketId, cameraId));
}

function sendFrame(socket, cameraId, payload, buffer) {
  socket.emit('roomCamera:frame', { id: cameraId, ...payload }, buffer);
}

function sendStatus(socket, cameraId, status) {
  socket.emit('roomCamera:status', { id: cameraId, ...status });
}

roomCameraStreamEvents.on('frame', ({ id, buffer, ts, stale }) => {
  const bucket = cameraSubscribers.get(id);
  if (!bucket || !buffer) return;
  bucket.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    sendFrame(socket, id, { ts, stale: !!stale }, buffer);
  });
});

roomCameraStreamEvents.on('status', ({ id, error }) => {
  const bucket = cameraSubscribers.get(id);
  if (!bucket) return;
  bucket.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    sendStatus(socket, id, { error: error || null });
  });
});

io.on('connection', (socket) => {
  socket.on('roomCamera:subscribe', (payload = {}, cb = () => {}) => {
    const cameraId = payload.roomCameraId || payload.id;
    try {
      if (!cameraId) {
        throw new Error('roomCameraId required');
      }
      const camera = getRoomCamera(cameraId);
      if (!camera) {
        throw new Error('Unknown room camera');
      }
      if (!canViewRoomCamera(socket)) {
        throw new Error('Not authorized for room camera');
      }
      addSubscription(socket, camera.id);
      const state = getRoomCameraState(camera.id);
      if (state?.frame) {
        sendFrame(socket, camera.id, { ts: state.ts, stale: !!state.stale }, state.frame);
      }
      sendStatus(socket, camera.id, { ts: state?.ts || null, stale: state?.stale ?? true, error: state?.error || null });
      cb({ ok: true });
    } catch (err) {
      logger.warn('Room camera subscribe failed', { socketId: socket.id, cameraId, err: err.message });
      cb({ error: err.message });
    }
  });

  socket.on('roomCamera:unsubscribe', (payload = {}) => {
    const cameraId = payload.roomCameraId || payload.id;
    if (!cameraId) return;
    removeSubscription(socket.id, String(cameraId));
  });

  socket.on('disconnect', () => {
    removeAllSubscriptions(socket.id);
  });
});
