const io = require('../globals/io');
const logger = require('../globals/logger');
const { sendAlert, COLORS } = require('./alertService');
const { parseSensorFrame } = require('../helpers/sensorDecoder');
const { MODES, getMode } = require('./modeManager');
const { isAdmin, roleEvents } = require('./roleService');

const rovers = new Map(); // roverId -> record
const socketToRovers = new Map(); // socketId -> Set(roverId)
const spectatorSockets = new Set();
const turnService = require('./turnService');

function ensureRecord(id) {
  if (!rovers.has(id)) {
    rovers.set(id, {
      id,
      meta: null,
      ws: null,
      lastSensor: null,
      drivers: new Set(),
      locked: false,
      room: `rover:${id}`,
      lastSeen: Date.now(),
    });
  }
  return rovers.get(id);
}

function upsertRover(meta, ws) {
  const id = meta.name || meta.id;
  const record = ensureRecord(id);
  record.meta = meta;
  record.ws = ws;
  record.lastSeen = Date.now();
  rovers.set(id, record);
  spectatorSockets.forEach((socketId) => {
    const sock = io.sockets.sockets.get(socketId);
    sock?.join(record.room);
  });
  broadcastRoster();
  return record;
}

function removeRover(id) {
  const record = rovers.get(id);
  if (!record) return;
  rovers.delete(id);
  turnService.cleanupRover(id);
  spectatorSockets.forEach((socketId) => {
    const sock = io.sockets.sockets.get(socketId);
    sock?.leave(record.room);
  });
  broadcastRoster();
}

function lockRover(id, locked, actorSocket) {
  const record = rovers.get(id);
  if (!record) {
    throw new Error('Unknown rover');
  }
  if (locked) {
    record.locked = true;
    sendAlert({ color: COLORS.warn, title: 'Rover Locked', message: `${id} locked by admin.` });
  } else {
    record.locked = false;
    sendAlert({ color: COLORS.success, title: 'Rover Unlocked', message: `${id} unlocked.` });
  }
  broadcastRoster();
  return record.locked;
}

function getRoster() {
  return Array.from(rovers.values()).map((record) => ({
    id: record.id,
    name: record.meta?.name || record.id,
    battery: record.meta?.battery,
    maxWheelSpeed: record.meta?.maxWheelSpeed,
    media: record.meta?.media,
    locked: record.locked,
    lastSeen: record.lastSeen,
  }));
}

function broadcastRoster() {
  io.emit('rovers', getRoster());
}

function handleSensorFrame(roverId, frame) {
  const record = rovers.get(roverId);
  if (!record) return;
  record.lastSeen = Date.now();
  const decoded = parseSensorFrame(frame.data);
  record.lastSensor = { raw: frame, decoded };
  io.to(record.room).emit('sensorFrame', {
    roverId,
    frame,
    sensors: decoded,
  });
}

function removeSocket(socket) {
  const joined = socketToRovers.get(socket.id);
  if (!joined) {
    disableSpectator(socket);
    return;
  }
  for (const roverId of joined) {
    const record = rovers.get(roverId);
    if (record) {
      record.drivers.delete(socket.id);
    }
    turnService.driverRemoved(roverId, socket.id);
  }
  socketToRovers.delete(socket.id);
  disableSpectator(socket);
}

function requestControl(roverId, socket) {
  const record = rovers.get(roverId);
  if (!record) {
    throw new Error('Unknown rover');
  }
  if (!isAdmin(socket)) {
    throw new Error('Only admins can request control');
  }
  if (record.locked && !isAdmin(socket)) {
    throw new Error('Rover locked');
  }
  const mode = getMode();
  if (mode === MODES.ADMIN && !isAdmin(socket)) {
    throw new Error('Admins only');
  }
  if (mode === MODES.LOCKDOWN && !isAdmin(socket)) {
    throw new Error('Server in lockdown');
  }
  record.drivers.add(socket.id);
  if (!socketToRovers.has(socket.id)) {
    socketToRovers.set(socket.id, new Set());
  }
  socketToRovers.get(socket.id).add(roverId);
  socket.join(record.room);
  turnService.driverAdded(roverId, socket.id);
  sendAlert({
    color: COLORS.success,
    title: 'Control Granted',
    message: `${socket.id} now driving ${roverId}`,
  });
  return { roverId, room: record.room };
}

function releaseControl(roverId, socket) {
  const record = rovers.get(roverId);
  if (!record) return;
  record.drivers.delete(socket.id);
  const joined = socketToRovers.get(socket.id);
  if (joined) {
    joined.delete(roverId);
    if (joined.size === 0) {
      socketToRovers.delete(socket.id);
    }
  }
  socket.leave(record.room);
  turnService.driverRemoved(roverId, socket.id);
}

function isDriver(roverId, socket) {
  const record = rovers.get(roverId);
  if (!record) return false;
  return record.drivers.has(socket.id);
}

function canDrive(roverId, socket) {
  return turnService.canDrive(roverId, socket) || isAdmin(socket);
}

module.exports = {
  upsertRover,
  removeRover,
  lockRover,
  getRoster,
  broadcastRoster,
  handleSensorFrame,
  requestControl,
  releaseControl,
  removeSocket,
  isDriver,
  canDrive,
  enableSpectator,
  disableSpectator,
  rovers,
};

roleEvents.on('change', ({ socket, role }) => {
  if (role === 'spectator') {
    enableSpectator(socket);
  } else {
    disableSpectator(socket);
  }
});

io.on('connection', (socket) => {
  socket.emit('rovers', getRoster());
  if (socket.data?.role === 'spectator') {
    enableSpectator(socket);
  }

  socket.on('requestControl', ({ roverId } = {}) => {
    try {
      const targetId = roverId || Array.from(rovers.keys())[0];
      if (!targetId) {
        throw new Error('No rovers available');
      }
      requestControl(targetId, socket);
      socket.emit('controlGranted', { roverId: targetId });
    } catch (err) {
      sendAlert({ color: COLORS.warn, title: 'Control denied', message: err.message });
    }
  });

  socket.on('releaseControl', ({ roverId }) => {
    if (!roverId) return;
    releaseControl(roverId, socket);
  });

  socket.on('lockRover', ({ roverId, locked }) => {
    if (!isAdmin(socket)) return;
    try {
      lockRover(roverId, locked);
    } catch (err) {
      sendAlert({ color: COLORS.error, title: 'Lock failed', message: err.message });
    }
  });

  socket.on('subscribeAll', () => {
    if (socket.data?.role !== 'spectator') {
      return;
    }
    for (const record of rovers.values()) {
      socket.join(record.room);
    }
  });

  socket.on('disconnect', () => {
    removeSocket(socket);
  });
});

function enableSpectator(socket) {
  if (!socket?.id || spectatorSockets.has(socket.id)) return;
  spectatorSockets.add(socket.id);
  for (const record of rovers.values()) {
    socket.join(record.room);
  }
}

function disableSpectator(socket) {
  if (!socket?.id || !spectatorSockets.has(socket.id)) return;
  spectatorSockets.delete(socket.id);
  for (const record of rovers.values()) {
    socket.leave(record.room);
  }
}
