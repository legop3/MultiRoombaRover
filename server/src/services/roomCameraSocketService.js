const io = require('../globals/io');
const logger = require('../globals/logger').child('roomCameraSocket');
const { getMode, MODES } = require('./modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('./roleService');
const { getRoomCamera, getRoomCameras } = require('./roomCameraService');
const { roomCameraStreamEvents, getRoomCameraState } = require('./roomCameraSnapshotService');

const SUBSCRIBE_LIMIT = 50;
const SUBSCRIBE_WINDOW_MS = 10000;

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
const subscribeBuckets = new Map(); // socketId -> { start, count }

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

function allowSubscribe(socketId) {
  const now = Date.now();
  let bucket = subscribeBuckets.get(socketId);
  if (!bucket || now - bucket.start >= SUBSCRIBE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
  }
  bucket.count += 1;
  subscribeBuckets.set(socketId, bucket);
  return bucket.count <= SUBSCRIBE_LIMIT;
}

function sendFrame(socket, cameraId, payload, buffer) {
  socket.emit('roomCamera:frame', { id: cameraId, ...payload }, buffer);
}

function sendStatus(socket, cameraId, status) {
  socket.emit('roomCamera:status', { id: cameraId, ...status });
}

roomCameraStreamEvents.on('frame', ({ id, buffer, ts }) => {
  const bucket = cameraSubscribers.get(id);
  if (!bucket || !buffer) return;
  bucket.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    sendFrame(socket, id, { ts }, buffer);
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
    const list = Array.isArray(payload?.ids)
      ? payload.ids.map(String)
      : payload?.roomCameraId || payload?.id
      ? [String(payload.roomCameraId || payload.id)]
      : getRoomCameras().map((cam) => cam.id);
    const uniqueIds = Array.from(new Set(list));
    try {
      if (!allowSubscribe(socket.id)) {
        cb({ error: 'Rate limited' });
        return;
      }
      if (!canViewRoomCamera(socket)) {
        throw new Error('Not authorized for room camera');
      }
      const validIds = uniqueIds.filter((id) => !!getRoomCamera(id));
      validIds.forEach((cameraId) => addSubscription(socket, cameraId));
      validIds.forEach((cameraId) => {
        const state = getRoomCameraState(cameraId);
        if (state?.frame) {
          sendFrame(socket, cameraId, { ts: state.ts }, state.frame);
        }
        sendStatus(socket, cameraId, {
          ts: state?.ts || null,
          error: state?.error || null,
        });
      });
      cb({ ok: true, subscribed: validIds });
    } catch (err) {
      logger.warn('Room camera subscribe failed', { socketId: socket.id, err: err.message });
      cb({ error: err.message });
    }
  });

  socket.on('roomCamera:unsubscribe', (payload = {}) => {
    const list = Array.isArray(payload?.ids)
      ? payload.ids.map(String)
      : payload?.roomCameraId || payload?.id
      ? [String(payload.roomCameraId || payload.id)]
      : [];
    list.forEach((cameraId) => removeSubscription(socket.id, cameraId));
  });

  socket.on('disconnect', () => {
    removeAllSubscriptions(socket.id);
    subscribeBuckets.delete(socket.id);
  });
});
