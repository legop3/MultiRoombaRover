// Rover Snapshot Socket Gateway
// Purpose: Handles rover snapshot socket subscriptions and streams rover frame/status updates to clients.
// Scope: Owns auth/rate-limit checks and per-socket subscription fan-out for rover snapshot events.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('roverSnapshotSocket');
const { getMode, MODES } = require('../modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('../roleService');

const SUBSCRIBE_LIMIT = 50;
const SUBSCRIBE_WINDOW_MS = 10000;
const STREAM_INTERVAL_MS = 333;

function passesMode(socket) {
  const mode = getMode();
  if (mode === MODES.LOCKDOWN) return isLockdownAdmin(socket);
  if (mode === MODES.ADMIN) {
    const role = getRole(socket);
    return role === 'spectator' || isAdmin(socket);
  }
  return true;
}

function registerRoverSnapshotSocketGateway({
  roverManager,
  roverSnapshotEvents,
  getRoverSnapshotState,
  fetchSnapshotNow,
}) {
  const roverSubscribers = new Map();
  const socketSubscriptions = new Map();
  const subscribeBuckets = new Map();
  const lastSentBySocket = new Map();
  const sentCounts = new Map();

  function addSubscription(socket, roverId) {
    if (!roverSubscribers.has(roverId)) roverSubscribers.set(roverId, new Set());
    roverSubscribers.get(roverId).add(socket.id);
    if (!socketSubscriptions.has(socket.id)) socketSubscriptions.set(socket.id, new Set());
    socketSubscriptions.get(socket.id).add(roverId);
  }

  function removeSubscription(socketId, roverId) {
    const bucket = roverSubscribers.get(roverId);
    if (bucket) {
      bucket.delete(socketId);
      if (bucket.size === 0) roverSubscribers.delete(roverId);
    }
    const socketBucket = socketSubscriptions.get(socketId);
    if (socketBucket) {
      socketBucket.delete(roverId);
      if (socketBucket.size === 0) socketSubscriptions.delete(socketId);
    }
  }

  function removeAllSubscriptions(socketId) {
    const bucket = socketSubscriptions.get(socketId);
    if (!bucket) return;
    bucket.forEach((roverId) => removeSubscription(socketId, roverId));
  }

  function allowSubscribe(socketId) {
    const now = Date.now();
    let bucket = subscribeBuckets.get(socketId);
    if (!bucket || now - bucket.start >= SUBSCRIBE_WINDOW_MS) bucket = { start: now, count: 0 };
    bucket.count += 1;
    subscribeBuckets.set(socketId, bucket);
    return bucket.count <= SUBSCRIBE_LIMIT;
  }

  function sendFrame(socket, roverId, payload, buffer) {
    socket.emit('roverSnapshot:frame', { id: roverId, ...payload }, buffer);
  }

  function sendStatus(socket, roverId, status) {
    socket.emit('roverSnapshot:status', { id: roverId, ...status });
  }

  roverSnapshotEvents.on('frame', ({ id, buffer, ts }) => {
    const bucket = roverSubscribers.get(id);
    if (!bucket || !buffer) return;
    bucket.forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return;
      let lastMap = lastSentBySocket.get(socketId);
      if (!lastMap) {
        lastMap = new Map();
        lastSentBySocket.set(socketId, lastMap);
      }
      const lastSent = lastMap.get(id) || 0;
      const now = ts || Date.now();
      if (now - lastSent < STREAM_INTERVAL_MS) return;
      lastMap.set(id, now);
      const key = `${socketId}:${id}`;
      const sentCount = (sentCounts.get(key) || 0) + 1;
      sentCounts.set(key, sentCount);
      if (sentCount === 1 || sentCount % 30 === 0) {
        logger.warn('Snapshot frame sent', { socketId, roverId: id, sentCount, ts, bytes: buffer.length });
      }
      sendFrame(socket, id, { ts }, buffer);
    });
  });

  roverSnapshotEvents.on('status', ({ id, error }) => {
    const bucket = roverSubscribers.get(id);
    if (!bucket) return;
    bucket.forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return;
      sendStatus(socket, id, { error: error || null });
    });
  });

  io.on('connection', (socket) => {
    logger.warn('Rover snapshot gateway saw socket connection', { socketId: socket.id });
    socket.on('roverSnapshot:subscribe', (payload = {}, cb = () => {}) => {
      const visibleRoster = roverManager.getRosterForSocket(socket);
      const visibleIds = visibleRoster.map((rover) => String(rover.id));
      const list = Array.isArray(payload?.ids)
        ? payload.ids.map(String)
        : payload?.roverId || payload?.id
        ? [String(payload.roverId || payload.id)]
        : visibleIds;
      const uniqueIds = Array.from(new Set(list));
      try {
        if (!allowSubscribe(socket.id)) return cb({ error: 'Rate limited' });
        if (!passesMode(socket)) throw new Error('Not authorized for rover snapshots');
        const rosterIds = new Set(visibleIds);
        const validIds = uniqueIds.filter((id) => rosterIds.has(String(id)));
        logger.warn('Rover snapshot subscribe', {
          socketId: socket.id,
          requestedIds: uniqueIds,
          visibleIds,
          subscribedIds: validIds,
        });
        validIds.forEach((roverId) => addSubscription(socket, roverId));
        validIds.forEach(async (roverId) => {
          if (typeof fetchSnapshotNow === 'function') {
            try {
              await fetchSnapshotNow(String(roverId), { force: true });
            } catch (err) {
              logger.warn('Immediate snapshot fetch failed', { roverId, err: err.message });
            }
          }
          const state = getRoverSnapshotState(roverId);
          if (state?.frame) sendFrame(socket, roverId, { ts: state.ts }, state.frame);
          sendStatus(socket, roverId, { ts: state?.ts || null, error: state?.error || null });
        });
        cb({ ok: true, subscribed: validIds });
      } catch (err) {
        logger.warn('Rover snapshot subscribe failed', { socketId: socket.id, err: err.message });
        cb({ error: err.message });
      }
    });

    socket.on('roverSnapshot:unsubscribe', (payload = {}) => {
      const list = Array.isArray(payload?.ids)
        ? payload.ids.map(String)
        : payload?.roverId || payload?.id
        ? [String(payload.roverId || payload.id)]
        : [];
      list.forEach((roverId) => removeSubscription(socket.id, roverId));
    });

    socket.on('disconnect', () => {
      removeAllSubscriptions(socket.id);
      subscribeBuckets.delete(socket.id);
      lastSentBySocket.delete(socket.id);
    });
  });
}

module.exports = {
  registerRoverSnapshotSocketGateway,
};
