const io = require('../globals/io');
const logger = require('../globals/logger');
const { sendAlert, COLORS } = require('./alertService');
const { parseSensorFrame } = require('../helpers/sensorDecoder');
const { MODES, getMode } = require('./modeManager');
const { isAdmin } = require('./authService');

const rovers = new Map(); // roverId -> record
const socketToRovers = new Map(); // socketId -> Set(roverId)

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
  broadcastRoster();
  return record;
}

function removeRover(id) {
  const record = rovers.get(id);
  if (!record) return;
  rovers.delete(id);
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
  if (!joined) return;
  for (const roverId of joined) {
    const record = rovers.get(roverId);
    if (record) {
      record.drivers.delete(socket.id);
    }
  }
  socketToRovers.delete(socket.id);
}

function requestControl(roverId, socket) {
  const record = rovers.get(roverId);
  if (!record) {
    throw new Error('Unknown rover');
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
  // TODO: future turns logic
  record.drivers.add(socket.id);
  if (!socketToRovers.has(socket.id)) {
    socketToRovers.set(socket.id, new Set());
  }
  socketToRovers.get(socket.id).add(roverId);
  socket.join(record.room);
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
}

function isDriver(roverId, socket) {
  const record = rovers.get(roverId);
  if (!record) return false;
  return record.drivers.has(socket.id);
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
  rovers,
};

io.on('connection', (socket) => {
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
    for (const record of rovers.values()) {
      socket.join(record.room);
    }
  });

  socket.on('disconnect', () => {
    removeSocket(socket);
  });
});
