const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('roverManager');
const { sendAlert, COLORS } = require('./alertService');
const { parseSensorFrame } = require('../helpers/sensorDecoder');
const { MODES, getMode } = require('./modeManager');
const { isAdmin, roleEvents } = require('./roleService');

const rovers = new Map(); // roverId -> record
const socketToRovers = new Map(); // socketId -> Set(roverId)
const spectatorSockets = new Set();
const turnService = require('./turnService');
const managerEvents = new EventEmitter();

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
  if (!meta.cameraServo) {
    logger.info('Rover hello missing camera servo block', { id, keys: Object.keys(meta || {}) });
  } else {
    logger.info('Rover hello camera servo', { id, servo: meta.cameraServo });
  }
  const record = ensureRecord(id);
  record.meta = meta;
  record.ws = ws;
  record.lastSeen = Date.now();
  rovers.set(id, record);
  spectatorSockets.forEach((socketId) => {
    const sock = io.sockets.sockets.get(socketId);
    sock?.join(record.room);
  });
  managerEvents.emit('rover', { roverId: id, action: 'upsert', record });
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
  managerEvents.emit('rover', { roverId: id, action: 'removed' });
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
  managerEvents.emit('lock', { roverId: id, locked: record.locked });
  return record.locked;
}

function getRoster() {
  return Array.from(rovers.values()).map((record) => ({
    id: record.id,
    name: record.meta?.name || record.id,
    battery: record.meta?.battery,
    maxWheelSpeed: record.meta?.maxWheelSpeed,
    media: record.meta?.media,
    cameraServo: record.meta?.cameraServo,
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
    managerEvents.emit('driver', { socketId: socket.id, roverId, action: 'remove' });
  }
  socketToRovers.delete(socket.id);
  disableSpectator(socket);
}

function requestControl(roverId, socket, options = {}) {
  const { force = false, allowUser = false } = options;
  const record = rovers.get(roverId);
  if (!record) {
    throw new Error('Unknown rover');
  }
  if (!allowUser && !isAdmin(socket)) {
    throw new Error('Only admins can request control');
  }
  if (record.locked && !isAdmin(socket) && !allowUser) {
    throw new Error('Rover locked');
  }
  const mode = getMode();
  if (!allowUser && mode === MODES.ADMIN && !isAdmin(socket)) {
    throw new Error('Admins only');
  }
  if (!allowUser && mode === MODES.LOCKDOWN && !isAdmin(socket)) {
    throw new Error('Server in lockdown');
  }
  record.drivers.add(socket.id);
  if (!socketToRovers.has(socket.id)) {
    socketToRovers.set(socket.id, new Set());
  }
  socketToRovers.get(socket.id).add(roverId);
  socket.join(record.room);
  turnService.driverAdded(roverId, socket.id, force && isAdmin(socket));
  socket.emit('controlGranted', { roverId });
  managerEvents.emit('driver', { socketId: socket.id, roverId, action: 'add' });
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
  managerEvents.emit('driver', { socketId: socket.id, roverId, action: 'remove' });
}

function isDriver(roverId, socket) {
  const record = rovers.get(roverId);
  if (!record) return false;
  return record.drivers.has(socket.id);
}

function canDrive(roverId, socket) {
  return turnService.canDrive(roverId, socket) || isAdmin(socket);
}

function getRoversForSocket(socketId) {
  const joined = socketToRovers.get(socketId);
  if (!joined || joined.size === 0) {
    return [];
  }
  return Array.from(joined);
}

function getPrimaryRoverForSocket(socketId) {
  const joined = socketToRovers.get(socketId);
  if (!joined || joined.size === 0) {
    return null;
  }
  const iterator = joined.values();
  const first = iterator.next();
  return first.done ? null : first.value;
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
  managerEvents,
  getRoversForSocket,
  getPrimaryRoverForSocket,
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

  function handleRequestControl({ roverId, force } = {}, cb = () => {}) {
    try {
      const targetId = roverId || Array.from(rovers.keys())[0];
      if (!targetId) {
        throw new Error('No rovers available');
      }
      logger.info('Request control', socket.id, targetId, { force });
      requestControl(targetId, socket, { force: Boolean(force) });
      socket.emit('controlGranted', { roverId: targetId });
      cb({ success: true, roverId: targetId });
    } catch (err) {
      logger.warn('Request control failed', socket.id, err.message);
      sendAlert({ color: COLORS.warn, title: 'Control denied', message: err.message });
      cb({ error: err.message });
    }
  }

  function handleReleaseControl({ roverId } = {}, cb = () => {}) {
    if (!roverId) {
      cb({ error: 'roverId required' });
      return;
    }
    logger.info('Release control', socket.id, roverId);
    releaseControl(roverId, socket);
    cb({ success: true, roverId });
  }

  function handleLockToggle({ roverId, locked } = {}, cb = () => {}) {
    if (!isAdmin(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      lockRover(roverId, locked);
      logger.info('Lock state changed', roverId, locked);
      cb({ success: true });
    } catch (err) {
      logger.warn('Lock change failed', roverId, err.message);
      sendAlert({ color: COLORS.error, title: 'Lock failed', message: err.message });
      cb({ error: err.message });
    }
  }

  function handleSubscribeAll(_, cb = () => {}) {
    if (socket.data?.role !== 'spectator') {
      cb({ error: 'Spectator role required' });
      return;
    }
    logger.info('Spectator subscribing to all rovers', socket.id);
    for (const record of rovers.values()) {
      socket.join(record.room);
    }
    cb({ success: true });
  }

  socket.on('requestControl', handleRequestControl);
  socket.on('session:requestControl', handleRequestControl);
  socket.on('releaseControl', handleReleaseControl);
  socket.on('session:releaseControl', handleReleaseControl);
  socket.on('lockRover', handleLockToggle);
  socket.on('session:lockRover', handleLockToggle);
  socket.on('subscribeAll', handleSubscribeAll);
  socket.on('session:subscribeAll', handleSubscribeAll);

  socket.on('disconnect', () => {
    logger.info('Socket disconnected', socket.id);
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
