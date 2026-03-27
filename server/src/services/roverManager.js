const EventEmitter = require('events');
const io = require('../globals/io');
const logger = require('../globals/logger').child('roverManager');
const { sendAlert } = require('./alertService');
const ALERT_COLOR = '#8bc34a';
const { parseSensorFrame } = require('../helpers/sensorDecoder');
const { MODES, getMode } = require('./modeManager');
const { isAdmin, isLockdownAdmin, roleEvents } = require('./roleService');
const { publishEvent } = require('./eventBus');
const videoSessions = require('./videoSessions');

const rovers = new Map(); // roverId -> record
const socketToRovers = new Map(); // socketId -> Set(roverId)
const spectatorSockets = new Set();
const turnService = require('./turnService');
const managerEvents = new EventEmitter();
const DOCK_GUARD_WINDOW_MS = 2 * 1000;
const IDLE_UNDOCKED_MS = 2 * 60 * 1000;
const PASSIVE_UNDOCKED_MS = 60 * 1000;
const DOCK_GUARD_RETRY_MS = 10 * 1000;
const DOCK_COMMAND_BASE64 = Buffer.from([143]).toString('base64');
const BACKOFF_MS = 500;
const BACKOFF_SPEED = 300;
const PRIVATE_BUTTON_HOLD_MS = 3000;
const PRIVATE_AUTO_CLOSE_IDLE_MS = 30 * 60 * 1000;
const PRIVATE_AUTO_CLOSE_TICK_MS = 30000;
const SAFETY_BACKOFF_MIN = -500;
const SAFETY_BACKOFF_MAX = 500;
const backoffTimers = new Map(); // roverId -> Timeout
const dockGuardStates = new Map(); // roverId -> guard state
const privateButtonStates = new Map(); // roverId -> { pressedSince:number|null, latched:boolean }
const privateNoUsersSince = new Map(); // roverId -> timestamp|null
const privateSafetyTimers = new Map(); // roverId -> Timeout
const privateSafetyStates = new Map(); // roverId -> state

const DEFAULT_PRIVATE_SAFETY = Object.freeze({
  speedLimitEnabled: false,
  speedLimitMaxWheelSpeed: 250,
  hardOvercurrentEnabled: false,
  overcurrentStopMs: 300,
  hardBumpEnabled: false,
  bumpBackoffSpeed: 250,
  bumpBackoffMs: 350,
  cliffEnabled: false,
  cliffBackoffSpeed: 250,
  cliffBackoffMs: 500,
  triggerCooldownMs: 800,
});

function parsePrivateMeta(meta = {}) {
  const raw = meta?.private;
  if (raw === true) {
    return { enabled: true, safety: { ...DEFAULT_PRIVATE_SAFETY } };
  }
  if (!raw || typeof raw !== 'object') {
    return { enabled: false, safety: { ...DEFAULT_PRIVATE_SAFETY } };
  }
  const safety = normalizePrivateSafety(raw.safety || {});
  return {
    enabled: Boolean(raw.enabled),
    safety,
  };
}

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizePrivateSafety(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    speedLimitEnabled: Boolean(source.speedLimitEnabled),
    speedLimitMaxWheelSpeed: clampInt(
      source.speedLimitMaxWheelSpeed,
      1,
      500,
      DEFAULT_PRIVATE_SAFETY.speedLimitMaxWheelSpeed,
    ),
    hardOvercurrentEnabled: Boolean(source.hardOvercurrentEnabled),
    overcurrentStopMs: clampInt(
      source.overcurrentStopMs,
      100,
      5000,
      DEFAULT_PRIVATE_SAFETY.overcurrentStopMs,
    ),
    hardBumpEnabled: Boolean(source.hardBumpEnabled),
    bumpBackoffSpeed: clampInt(
      source.bumpBackoffSpeed,
      1,
      500,
      DEFAULT_PRIVATE_SAFETY.bumpBackoffSpeed,
    ),
    bumpBackoffMs: clampInt(
      source.bumpBackoffMs,
      100,
      5000,
      DEFAULT_PRIVATE_SAFETY.bumpBackoffMs,
    ),
    cliffEnabled: Boolean(source.cliffEnabled),
    cliffBackoffSpeed: clampInt(
      source.cliffBackoffSpeed,
      1,
      500,
      DEFAULT_PRIVATE_SAFETY.cliffBackoffSpeed,
    ),
    cliffBackoffMs: clampInt(
      source.cliffBackoffMs,
      100,
      5000,
      DEFAULT_PRIVATE_SAFETY.cliffBackoffMs,
    ),
    triggerCooldownMs: clampInt(
      source.triggerCooldownMs,
      100,
      10000,
      DEFAULT_PRIVATE_SAFETY.triggerCooldownMs,
    ),
  };
}

function isPrivateRecord(record) {
  return Boolean(record?.private?.enabled);
}

function isPrivateOpen(record) {
  if (!isPrivateRecord(record)) return true;
  return Boolean(record?.privateOpen);
}

function getPrivateSafety(record) {
  if (!record) return { ...DEFAULT_PRIVATE_SAFETY };
  return normalizePrivateSafety(record.privateSafety || record.private?.safety || {});
}

function shouldApplyPrivateSafety(record, socket) {
  if (!isPrivateRecord(record)) return false;
  if (isLockdownAdmin(socket)) return false;
  return true;
}

function shouldApplyPrivateSensorSafety(record) {
  if (!isPrivateRecord(record)) return false;
  const activeDrivers = turnService.getActiveDrivers();
  const activeDriverId = activeDrivers?.[record.id];
  if (!activeDriverId) return false;
  const activeSocket = io.sockets.sockets.get(activeDriverId);
  if (!activeSocket) return true;
  return !isLockdownAdmin(activeSocket);
}

function isRoverVisibleToSocket(record, socket) {
  if (!record) return false;
  if (!isPrivateRecord(record)) return true;
  if (isPrivateOpen(record)) return true;
  return isLockdownAdmin(socket);
}

function getControlDenialReason(record, socket, options = {}) {
  const { allowUser = false } = options;
  if (!record) {
    return 'Unknown rover';
  }
  if (!allowUser && !isAdmin(socket)) {
    return 'Only admins can request control';
  }
  if (record.locked && !isAdmin(socket)) {
    return 'Rover locked';
  }
  const mode = getMode();
  if (!allowUser && mode === MODES.ADMIN && !isAdmin(socket)) {
    return 'Admins only';
  }
  if (!allowUser && mode === MODES.LOCKDOWN && !isLockdownAdmin(socket)) {
    return 'Server in lockdown';
  }
  if (mode === MODES.LOCKDOWN && !isLockdownAdmin(socket)) {
    return 'Server in lockdown';
  }
  if (!isPrivateRecord(record)) {
    return null;
  }
  if (!isPrivateOpen(record)) {
    if (!isLockdownAdmin(socket)) {
      return 'Private rover is closed';
    }
    return null;
  }
  if (isLockdownAdmin(socket)) {
    return null;
  }
  const { isVerified } = require('./verificationService');
  if (!isVerified(socket)) {
    return 'Private rover requires verification';
  }
  return null;
}

function ensureRecord(id) {
  if (!rovers.has(id)) {
    rovers.set(id, {
      id,
      meta: null,
      ws: null,
      lastSensor: null,
      docked: null,
      lastBumpAt: null,
      drivers: new Set(),
      locked: false,
      lockReason: null,
      batteryState: null,
      nightVisionState: null,
      room: `rover:${id}`,
      lastSeen: Date.now(),
      lastMovementAt: Date.now(),
      private: { enabled: false },
      privateOpen: true,
      privateSafety: { ...DEFAULT_PRIVATE_SAFETY },
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
  const isNew = !rovers.has(id);
  const record = ensureRecord(id);
  record.meta = meta;
  record.ws = ws;
  record.lastSeen = Date.now();
  const privateMeta = parsePrivateMeta(meta);
  const wasPrivate = isPrivateRecord(record);
  record.private = privateMeta;
  record.privateSafety = normalizePrivateSafety(privateMeta.safety);
  if (privateMeta.enabled) {
    if (isNew || !wasPrivate) {
      record.privateOpen = false;
    }
  } else {
    record.privateOpen = true;
  }
  if (record.nightVisionState == null && meta?.nightVision?.enabled) {
    const ledOn = Boolean(meta.nightVision.initialOn);
    record.nightVisionState = {
      nightVisionOn: !ledOn,
      updatedAt: Date.now(),
    };
  }
  rovers.set(id, record);
  spectatorSockets.forEach((socketId) => {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) return;
    if (isRoverVisibleToSocket(record, sock)) {
      sock.join(record.room);
    } else {
      sock.leave(record.room);
    }
  });
  managerEvents.emit('rover', { roverId: id, action: 'upsert', record });
  if (isNew) {
    publishEvent({ source: 'roverManager', type: 'rover.online', payload: { roverId: id } });
  }
  broadcastRoster();
  return record;
}

function removeRover(id) {
  const record = rovers.get(id);
  if (!record) return;
  rovers.delete(id);
  stopDockGuard(id);
  privateButtonStates.delete(id);
  privateNoUsersSince.delete(id);
  privateSafetyStates.delete(id);
  clearTimeout(privateSafetyTimers.get(id));
  privateSafetyTimers.delete(id);
  turnService.cleanupRover(id);
  spectatorSockets.forEach((socketId) => {
    const sock = io.sockets.sockets.get(socketId);
    sock?.leave(record.room);
  });
  broadcastRoster();
  managerEvents.emit('rover', { roverId: id, action: 'removed' });
  publishEvent({ source: 'roverManager', type: 'rover.offline', payload: { roverId: id } });
}

function sendPrivateToggleTTS(roverId, open, reason) {
  const { issueCommand } = require('./commandService');
  let text = open ? 'Private rover is now open.' : 'Private rover is now closed.';
  if (!open && reason === 'auto_idle') {
    text = 'Private rover closed due to inactivity.';
  } else if (reason === 'button_hold') {
    text = open ? 'Private rover opened locally.' : 'Private rover closed locally.';
  }
  try {
    issueCommand(roverId, {
      type: 'tts',
      tts: {
        text,
        speak: true,
      },
    });
  } catch (err) {
    logger.warn('Private toggle TTS failed', { roverId, reason, error: err.message });
  }
}

function lockRover(id, locked, options = {}) {
  const record = rovers.get(id);
  if (!record) {
    throw new Error('Unknown rover');
  }
  const wasAllUnlocked = Array.from(rovers.values()).every((entry) => !entry.locked);
  const reason = locked ? options.reason || 'manual' : null;
  const silent = Boolean(options.silent);
  if (locked) {
    record.locked = true;
    record.lockReason = reason;
    if (!silent) {
      sendAlert({
        color: ALERT_COLOR,
        title: 'Rover Locked',
        message: `${id} locked${record.lockReason ? ` (${record.lockReason})` : ''}.`,
      });
    }
    publishEvent({
      source: 'roverManager',
      type: 'rover.locked',
      payload: { roverId: id, reason: record.lockReason },
    });
  } else {
    record.locked = false;
    record.lockReason = null;
    if (!silent) {
      sendAlert({ color: ALERT_COLOR, title: 'Rover Unlocked', message: `${id} unlocked.` });
    }
    publishEvent({
      source: 'roverManager',
      type: 'rover.unlocked',
      payload: { roverId: id },
    });
    const isAllUnlocked = Array.from(rovers.values()).every((entry) => !entry.locked);
    if (!wasAllUnlocked && isAllUnlocked) {
      publishEvent({
        source: 'roverManager',
        type: 'rovers.allUnlocked',
        payload: { roverId: id },
      });
    }
  }
  broadcastRoster();
  managerEvents.emit('lock', { roverId: id, locked: record.locked, reason: record.lockReason });
  return record.locked;
}

function setPrivateOpen(id, open, options = {}) {
  const record = rovers.get(id);
  if (!record) {
    throw new Error('Unknown rover');
  }
  if (!isPrivateRecord(record)) {
    throw new Error('Rover is not private');
  }
  const nextOpen = Boolean(open);
  if (record.privateOpen === nextOpen) {
    return nextOpen;
  }
  record.privateOpen = nextOpen;
  const reason = options.reason || 'manual';
  const silent = Boolean(options.silent);
  if (!nextOpen) {
    privateNoUsersSince.delete(id);
    privateSafetyStates.delete(id);
    clearTimeout(privateSafetyTimers.get(id));
    privateSafetyTimers.delete(id);
  }
  if (!silent) {
    sendAlert({
      color: ALERT_COLOR,
      title: nextOpen ? 'Private Rover Opened' : 'Private Rover Closed',
      message: nextOpen ? `${id} opened (${reason}).` : `${id} closed (${reason}).`,
    });
  }
  if (options.tts !== false) {
    sendPrivateToggleTTS(id, nextOpen, reason);
  }
  publishEvent({
    source: 'roverManager',
    type: nextOpen ? 'rover.privateOpened' : 'rover.privateClosed',
    payload: { roverId: id, reason },
  });
  managerEvents.emit('private', { roverId: id, open: nextOpen, reason });
  broadcastRoster();
  return nextOpen;
}

function setPrivateSafety(id, patch = {}, options = {}) {
  const record = rovers.get(id);
  if (!record) {
    throw new Error('Unknown rover');
  }
  if (!isPrivateRecord(record)) {
    throw new Error('Rover is not private');
  }
  const current = getPrivateSafety(record);
  const next = normalizePrivateSafety({ ...current, ...(patch || {}) });
  record.privateSafety = next;
  const reason = options.reason || 'manual';
  publishEvent({
    source: 'roverManager',
    type: 'rover.privateSafetyUpdated',
    payload: { roverId: id, reason, safety: next },
  });
  managerEvents.emit('privateSafety', { roverId: id, reason, safety: next });
  broadcastRoster();
  return next;
}

function getRoster() {
  return Array.from(rovers.values()).map((record) => ({
    id: record.id,
    name: record.meta?.name || record.id,
    color: record.meta?.color || null,
    battery: record.meta?.battery,
    batteryState: record.batteryState,
    maxWheelSpeed: record.meta?.maxWheelSpeed,
    media: record.meta?.media,
    cameraServo: record.meta?.cameraServo,
    audio: record.meta?.audio,
    horn: record.meta?.horn,
    nightVision: record.meta?.nightVision
      ? { ...record.meta.nightVision, state: record.nightVisionState }
      : record.meta?.nightVision,
    locked: record.locked || (isPrivateRecord(record) && !isPrivateOpen(record)),
    lockReason:
      record.lockReason || (isPrivateRecord(record) && !isPrivateOpen(record) ? 'private' : null),
    lastSeen: record.lastSeen,
    private: isPrivateRecord(record)
      ? {
          enabled: true,
          open: isPrivateOpen(record),
          safety: getPrivateSafety(record),
        }
      : {
          enabled: false,
          open: true,
          safety: getPrivateSafety(record),
        },
  }));
}

function getRosterForSocket(socket) {
  return getRoster()
    .filter((entry) => {
      const record = rovers.get(String(entry.id));
      return isRoverVisibleToSocket(record, socket);
    });
}

function syncSpectatorRooms() {
  spectatorSockets.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    for (const record of rovers.values()) {
      if (isRoverVisibleToSocket(record, socket)) {
        socket.join(record.room);
      } else {
        socket.leave(record.room);
      }
    }
  });
}

function broadcastRoster() {
  syncSpectatorRooms();
  io.sockets.sockets.forEach((socket) => {
    socket.emit('rovers', getRosterForSocket(socket));
  });
}

function setNightVisionState(roverId, nightVisionOn) {
  const record = rovers.get(roverId);
  if (!record) return;
  if (typeof nightVisionOn !== 'boolean') return;
  record.nightVisionState = {
    nightVisionOn,
    updatedAt: Date.now(),
  };
  broadcastRoster();
  managerEvents.emit('rover', { roverId, action: 'nightVision', record });
}

function computeBatteryState(record, sensors) {
  if (!record) return null;
  if (!sensors) return record.batteryState;
  const config = record.meta?.battery || null;
  const charge = sensors?.batteryChargeMah ?? null;
  const capacity = sensors?.batteryCapacityMah ?? null;
  const full = typeof config?.Full === 'number' ? config.Full : null;
  const warn = typeof config?.Warn === 'number' ? config.Warn : null;
  const urgent = typeof config?.Urgent === 'number' ? config.Urgent : null;
  let percent = null;
  if (charge != null && warn != null && full != null && full > warn) {
    const span = full - warn;
    percent = (charge - warn) / span;
  } else if (charge != null && capacity != null && capacity > 0) {
    percent = charge / capacity;
  }
  if (percent != null) {
    percent = Math.max(0, Math.min(1, percent));
  }
  const percentDisplay = computeBatteryDisplayPercent({
    charge,
    full,
    warn,
    urgent,
    percent,
    capacity,
  });
  return {
    charge,
    capacity,
    full,
    warn,
    urgent,
    percent,
    percentDisplay,
    warnActive: Boolean(warn != null && charge != null && charge <= warn),
    urgentActive: Boolean(urgent != null && charge != null && charge <= urgent),
    updatedAt: Date.now(),
  };
}

function computeBatteryDisplayPercent({ charge, full, warn, urgent, percent, capacity }) {
  if (
    charge != null &&
    full != null &&
    warn != null &&
    urgent != null &&
    full > warn &&
    warn > urgent
  ) {
    if (charge <= urgent) return 0;
    if (charge <= warn) {
      const t = (charge - urgent) / (warn - urgent);
      return Math.round(Math.max(0, Math.min(1, t)) * 10);
    }
    if (charge >= full) return 100;
    const t = (charge - warn) / (full - warn);
    return Math.round((0.1 + Math.max(0, Math.min(1, t)) * 0.9) * 100);
  }
  if (percent != null && Number.isFinite(percent)) {
    return Math.round(Math.max(0, Math.min(1, percent)) * 100);
  }
  if (charge != null && capacity != null && capacity > 0) {
    const fallback = charge / capacity;
    return Math.round(Math.max(0, Math.min(1, fallback)) * 100);
  }
  return null;
}

function getPrivateSafetyState(roverId) {
  if (!privateSafetyStates.has(roverId)) {
    privateSafetyStates.set(roverId, {
      blockedUntil: 0,
      lastOvercurrent: false,
      lastBump: false,
      lastCliff: false,
    });
  }
  return privateSafetyStates.get(roverId);
}

function stopSafetyBackoffTimer(roverId) {
  clearTimeout(privateSafetyTimers.get(roverId));
  privateSafetyTimers.delete(roverId);
}

function triggerSafetyAction(record, mode, options = {}) {
  if (!record) return;
  const roverId = record.id;
  const { issueCommand, setDriveCooldown } = require('./commandService');
  const now = Date.now();
  const cooldownMs = clampInt(options.cooldownMs, 100, 10000, DEFAULT_PRIVATE_SAFETY.triggerCooldownMs);
  const backoffMs = clampInt(options.backoffMs, 50, 5000, 0);
  const backoffSpeed = clampInt(options.backoffSpeed, 0, 500, 0);
  try {
    issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
    issueCommand(roverId, { type: 'motors', motorPwm: { main: 0, side: 0, vacuum: 0 } });
  } catch (err) {
    logger.warn('Private safety stop failed', { roverId, mode, error: err.message });
  }
  stopSafetyBackoffTimer(roverId);
  if (backoffMs > 0 && backoffSpeed > 0) {
    const speed = Math.max(SAFETY_BACKOFF_MIN, Math.min(SAFETY_BACKOFF_MAX, -Math.abs(backoffSpeed)));
    try {
      issueCommand(roverId, { type: 'drive', driveDirect: { left: speed, right: speed } });
    } catch (err) {
      logger.warn('Private safety backoff failed', { roverId, mode, error: err.message });
    }
    privateSafetyTimers.set(
      roverId,
      setTimeout(() => {
        try {
          issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
        } catch (err) {
          logger.warn('Private safety backoff stop failed', { roverId, mode, error: err.message });
        }
        privateSafetyTimers.delete(roverId);
      }, backoffMs),
    );
  }
  setDriveCooldown(roverId, Math.max(cooldownMs, backoffMs));
  const state = getPrivateSafetyState(roverId);
  state.blockedUntil = now + Math.max(cooldownMs, backoffMs);
  sendAlert({
    color: ALERT_COLOR,
    title: 'Private Safety',
    message: `${roverId} ${mode} safety triggered.`,
  });
  publishEvent({
    source: 'roverManager',
    type: 'rover.privateSafetyTriggered',
    payload: { roverId, mode, cooldownMs, backoffMs, backoffSpeed },
  });
}

function evaluatePrivateSafety(record, sensors) {
  if (!record || !sensors) return;
  const roverId = record.id;
  const state = getPrivateSafetyState(roverId);
  const overcurrent = Boolean(
    sensors?.wheelOvercurrents?.leftWheel ||
      sensors?.wheelOvercurrents?.rightWheel ||
      sensors?.wheelOvercurrents?.mainBrush ||
      sensors?.wheelOvercurrents?.sideBrush,
  );
  const bump = Boolean(sensors?.bumpsAndWheelDrops?.bumpLeft || sensors?.bumpsAndWheelDrops?.bumpRight);
  const cliff = Boolean(
    sensors?.cliffLeft || sensors?.cliffFrontLeft || sensors?.cliffFrontRight || sensors?.cliffRight,
  );
  const currentOver = overcurrent;
  const currentBump = bump;
  const currentCliff = cliff;

  if (!shouldApplyPrivateSensorSafety(record)) {
    state.blockedUntil = 0;
    state.lastOvercurrent = currentOver;
    state.lastBump = currentBump;
    state.lastCliff = currentCliff;
    return;
  }
  const safety = getPrivateSafety(record);
  const now = Date.now();
  if (now < Number(state.blockedUntil || 0)) {
    state.lastOvercurrent = currentOver;
    state.lastBump = currentBump;
    state.lastCliff = currentCliff;
    return;
  }

  let triggered = false;
  if (safety.hardOvercurrentEnabled && currentOver && !state.lastOvercurrent) {
    triggerSafetyAction(record, 'overcurrent', {
      cooldownMs: safety.triggerCooldownMs,
      backoffMs: safety.overcurrentStopMs,
      backoffSpeed: 0,
    });
    triggered = true;
  } else if (safety.hardBumpEnabled && currentBump && !state.lastBump) {
    triggerSafetyAction(record, 'bump', {
      cooldownMs: safety.triggerCooldownMs,
      backoffMs: safety.bumpBackoffMs,
      backoffSpeed: safety.bumpBackoffSpeed,
    });
    triggered = true;
  } else if (safety.cliffEnabled && currentCliff && !state.lastCliff) {
    triggerSafetyAction(record, 'cliff', {
      cooldownMs: safety.triggerCooldownMs,
      backoffMs: safety.cliffBackoffMs,
      backoffSpeed: safety.cliffBackoffSpeed,
    });
    triggered = true;
  }
  if (!triggered) {
    state.blockedUntil = 0;
  }
  state.lastOvercurrent = currentOver;
  state.lastBump = currentBump;
  state.lastCliff = currentCliff;
}

function applyPrivateDriveSafety(roverId, socket, driveDirect = null) {
  const record = rovers.get(String(roverId));
  if (!record || !driveDirect || typeof driveDirect !== 'object') {
    return driveDirect;
  }
  if (!shouldApplyPrivateSafety(record, socket)) {
    return driveDirect;
  }
  const safety = getPrivateSafety(record);
  if (!safety.speedLimitEnabled) {
    return driveDirect;
  }
  const limit = clampInt(
    safety.speedLimitMaxWheelSpeed,
    1,
    500,
    DEFAULT_PRIVATE_SAFETY.speedLimitMaxWheelSpeed,
  );
  const left = clampInt(driveDirect.left, -500, 500, 0);
  const right = clampInt(driveDirect.right, -500, 500, 0);
  return {
    ...driveDirect,
    left: Math.max(-limit, Math.min(limit, left)),
    right: Math.max(-limit, Math.min(limit, right)),
  };
}

function handlePrivateButtonHold(record, sensors) {
  if (!record || !isPrivateRecord(record)) return;
  const buttons = sensors?.buttons || null;
  const pressed = Boolean(buttons?.spot && buttons?.clean && buttons?.dock);
  const roverId = record.id;
  const now = Date.now();
  const state = privateButtonStates.get(roverId) || { pressedSince: null, latched: false };
  if (!pressed) {
    if (state.pressedSince != null || state.latched) {
      privateButtonStates.set(roverId, { pressedSince: null, latched: false });
    }
    return;
  }
  if (state.pressedSince == null) {
    state.pressedSince = now;
  }
  if (!state.latched && now - state.pressedSince >= PRIVATE_BUTTON_HOLD_MS) {
    const nextOpen = !isPrivateOpen(record);
    try {
      setPrivateOpen(roverId, nextOpen, { reason: 'button_hold', tts: true });
    } catch (err) {
      logger.warn('Private button toggle failed', { roverId, error: err.message });
    }
    state.latched = true;
  }
  privateButtonStates.set(roverId, state);
}

function handleSensorFrame(roverId, frame) {
  const record = rovers.get(roverId);
  if (!record) return;
  record.lastSeen = Date.now();
  const decoded = parseSensorFrame(frame.data);
  record.lastSensor = { raw: frame, decoded };
  record.batteryState = computeBatteryState(record, decoded);
  updateMovement(record, decoded);
  const hasDockInfo = decoded?.chargingSources != null;
  if (hasDockInfo) {
    const prevDocked = record.docked;
    const docked = Boolean(decoded?.chargingSources?.homeBase);
    record.docked = docked;
    if (prevDocked === true && docked === false) {
      handleIdleUndock(record);
    }
  }
  const bumps = decoded?.bumpsAndWheelDrops;
  if (bumps?.bumpLeft || bumps?.bumpRight) {
    record.lastBumpAt = Date.now();
  }
  handlePrivateButtonHold(record, decoded);
  evaluatePrivateSafety(record, decoded);
  io.to(record.room).volatile.emit('sensorFrame', {
    roverId,
    frame,
    sensors: decoded,
  });
  managerEvents.emit('sensor', { roverId, sensors: decoded, batteryState: record.batteryState });
  evaluateDockGuard(record, decoded);
}

function updateMovement(record, sensors) {
  if (!record || !sensors) return;
  const distance = Math.abs(sensors.distanceMm ?? 0);
  const angle = Math.abs(sensors.angleDeg ?? 0);
  const requested = Math.abs(sensors.requestedVelocity ?? 0);
  const requestedLeft = Math.abs(sensors.requestedLeftVelocity ?? 0);
  const requestedRight = Math.abs(sensors.requestedRightVelocity ?? 0);
  const moving = distance > 0 || angle > 0 || requested > 0 || requestedLeft > 0 || requestedRight > 0;
  if (moving) {
    record.lastMovementAt = Date.now();
  }
}

function getDockGuardState(roverId) {
  if (!dockGuardStates.has(roverId)) {
    dockGuardStates.set(roverId, {
      idleUndockedSince: null,
      passiveUndockedSince: null,
      active: false,
      reason: null,
      startedAt: null,
      timer: null,
    });
  }
  return dockGuardStates.get(roverId);
}

function evaluateDockGuard(record, sensors) {
  if (!record || !sensors) return;
  const state = getDockGuardState(record.id);
  const now = Date.now();
  const docked = Boolean(sensors?.chargingSources?.homeBase);
  const oiMode = sensors?.oiMode?.label || null;
  const idleMs = record.lastMovementAt ? now - record.lastMovementAt : 0;
  const isIdle = idleMs >= 1000;

  if (docked || record.drivers.size > 0 || !isIdle) {
    state.idleUndockedSince = null;
  } else if (!state.idleUndockedSince) {
    state.idleUndockedSince = now;
  }

  if (docked || oiMode !== 'passive' || !isIdle) {
    state.passiveUndockedSince = null;
  } else if (!state.passiveUndockedSince) {
    state.passiveUndockedSince = now;
  }

  if (state.active) {
    const shouldStop =
      docked ||
      !isIdle ||
      (state.reason === 'idle' && record.drivers.size > 0) ||
      (state.reason === 'passive' && oiMode !== 'passive');
    if (shouldStop) {
      stopDockGuard(record.id);
    }
    return;
  }

  const idleReady =
    state.idleUndockedSince && now - state.idleUndockedSince >= IDLE_UNDOCKED_MS;
  const passiveReady =
    state.passiveUndockedSince && now - state.passiveUndockedSince >= PASSIVE_UNDOCKED_MS;

  if (passiveReady) {
    startDockGuard(record, 'passive', idleMs);
  } else if (idleReady) {
    startDockGuard(record, 'idle', idleMs);
  }
}

function startDockGuard(record, reason, idleMs) {
  if (!record) return;
  const state = getDockGuardState(record.id);
  if (state.active) return;
  state.active = true;
  state.reason = reason;
  state.startedAt = Date.now();
  const reasonText = reason === 'passive' ? 'passive mode' : 'idle and undocked';
  sendAlert({
    color: ALERT_COLOR,
    title: 'Dock Guard Triggered',
    message: `${record.id} ${reasonText}. Seeking dock and restarting sensors until movement.`,
  });
  publishEvent({
    source: 'roverManager',
    type: 'rover.dockGuard',
    payload: {
      roverId: record.id,
      reason,
      reasonText,
      idleMs,
    },
  });
  attemptDockGuard(record.id);
  state.timer = setInterval(() => attemptDockGuard(record.id), DOCK_GUARD_RETRY_MS);
}

function stopDockGuard(roverId) {
  const state = dockGuardStates.get(roverId);
  if (!state) return;
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.active = false;
  state.reason = null;
  state.startedAt = null;
  state.timer = null;
  state.idleUndockedSince = null;
  state.passiveUndockedSince = null;
}

function attemptDockGuard(roverId) {
  const record = rovers.get(roverId);
  if (!record) {
    stopDockGuard(roverId);
    return;
  }
  const { issueCommand } = require('./commandService');
  try {
    issueCommand(roverId, { type: 'sensorStream', sensorStream: { enable: true } });
    issueCommand(roverId, { type: 'raw', raw: DOCK_COMMAND_BASE64 });
  } catch (err) {
    logger.warn('Dock guard command failed', roverId, err.message);
  }
}
function handleIdleUndock(undockedRecord) {
  if (!undockedRecord || undockedRecord.drivers.size > 0) return;
  const now = Date.now();
  const { getRecentDriveActivity, setDriveCooldown, issueCommand } = require('./commandService');
  const candidates = getRecentDriveActivity(DOCK_GUARD_WINDOW_MS, { excludeAdmins: true })
    .filter((candidate) => candidate.roverId !== undockedRecord.id);
  if (candidates.length === 0) return;
  const candidatesWithBump = candidates.filter((candidate) => {
    const record = rovers.get(candidate.roverId);
    return record?.lastBumpAt && now - record.lastBumpAt <= DOCK_GUARD_WINDOW_MS;
  });
  const pool = candidatesWithBump.length > 0 ? candidatesWithBump : candidates;
  pool.sort((a, b) => b.ts - a.ts);
  const suspect = pool[0];
  if (!suspect) return;
  const suspectRecord = rovers.get(suspect.roverId);
  if (!suspectRecord) return;
  const bumpRecent =
    suspectRecord.lastBumpAt && now - suspectRecord.lastBumpAt <= DOCK_GUARD_WINDOW_MS;
  sendAlert({
    color: ALERT_COLOR,
    title: 'Dock protection',
    message: `${undockedRecord.id} undocked while idle; stopping ${suspect.roverId}.`,
  });
  try {
    issueCommand(suspect.roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
    issueCommand(suspect.roverId, { type: 'motors', motorPwm: { main: 0, side: 0, vacuum: 0 } });
  } catch (err) {
    logger.warn('Dock protection stop failed', suspect.roverId, err.message);
  }
  setDriveCooldown(suspect.roverId, DOCK_GUARD_WINDOW_MS);
  if (bumpRecent) {
    nudgeRover(suspect.roverId, 'backward');
  } else {
    nudgeRover(suspect.roverId, 'forward');
  }
}

function nudgeRover(roverId, direction = 'backward') {
  if (!roverId) return;
  const { issueCommand } = require('./commandService');
  clearTimeout(backoffTimers.get(roverId));
  const speed = direction === 'forward' ? BACKOFF_SPEED : -BACKOFF_SPEED;
  try {
    issueCommand(roverId, {
      type: 'drive',
      driveDirect: { left: speed, right: speed },
    });
  } catch (err) {
    logger.warn('Dock protection nudge failed', roverId, err.message);
    return;
  }
  backoffTimers.set(
    roverId,
    setTimeout(() => {
      try {
        issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
      } catch (err) {
        logger.warn('Dock protection backoff stop failed', roverId, err.message);
      }
    }, BACKOFF_MS),
  );
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
  const denied = getControlDenialReason(record, socket, { allowUser });
  if (denied) {
    throw new Error(denied);
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
    color: ALERT_COLOR,
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
  const record = rovers.get(roverId);
  if (!record) return false;
  const denied = getControlDenialReason(record, socket, { allowUser: true });
  if (denied) {
    return false;
  }
  const mode = getMode();
  if (isAdmin(socket)) {
    return true;
  }
  if (!socket || !isDriver(roverId, socket)) {
    return false;
  }
  return turnService.canDrive(roverId, socket);
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

function isDockedAndCharging(record) {
  const sensors = record?.lastSensor?.decoded || record?.lastSensor?.sensors || null;
  if (!sensors) return false;
  const docked = Boolean(sensors.chargingSources?.homeBase);
  const code = sensors.chargingState?.code;
  const charging = code === 2 || code === 3 || code === 4;
  return docked && charging;
}

function hasOtherDrivers(record, socketId) {
  if (!record) return false;
  for (const driver of record.drivers) {
    if (driver !== socketId) return true;
  }
  return false;
}

function canSwitchRover(socket, targetRoverId) {
  const target = rovers.get(targetRoverId);
  if (!target) {
    return { ok: false, message: 'Unknown rover' };
  }
  const denied = getControlDenialReason(target, socket, { allowUser: true });
  if (denied) {
    return { ok: false, message: denied };
  }
  const currentId = getPrimaryRoverForSocket(socket.id);
  if (!currentId || currentId === targetRoverId) {
    return { ok: true, currentId };
  }
  const currentRecord = rovers.get(currentId);
  if (!currentRecord) {
    return { ok: true, currentId };
  }
  if (hasOtherDrivers(currentRecord, socket.id)) {
    return { ok: true, currentId };
  }
  if (isDockedAndCharging(currentRecord)) {
    return { ok: true, currentId };
  }
  return { ok: false, currentId, message: 'Dock and charge your current rover before switching.' };
}

function canSeeRover(roverId, socket) {
  const record = rovers.get(String(roverId));
  return isRoverVisibleToSocket(record, socket);
}

function canRequestControl(roverId, socket, options = {}) {
  const record = rovers.get(String(roverId));
  const denied = getControlDenialReason(record, socket, options);
  return { ok: !denied, reason: denied || null };
}

function canReplayRoverId(roverId) {
  const record = rovers.get(String(roverId));
  if (!record) return false;
  if (!isPrivateRecord(record)) return true;
  return isPrivateOpen(record);
}

module.exports = {
  upsertRover,
  removeRover,
  lockRover,
  setPrivateOpen,
  setPrivateSafety,
  getRoster,
  getRosterForSocket,
  broadcastRoster,
  setNightVisionState,
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
  canSeeRover,
  canRequestControl,
  applyPrivateDriveSafety,
  canReplayRoverId,
};

roleEvents.on('change', ({ socket, role }) => {
  if (role === 'spectator') {
    enableSpectator(socket);
  } else {
    disableSpectator(socket);
  }
});

io.on('connection', (socket) => {
  tickPrivateAutoClose();
  socket.emit('rovers', getRosterForSocket(socket));
  if (socket.data?.role === 'spectator') {
    enableSpectator(socket);
  }

  function handleRequestControl({ roverId, force } = {}, cb = () => {}) {
    try {
      if (socket.data?.role === 'spectator') {
        throw new Error('Spectators cannot drive');
      }
      const mode = getMode();
      if (
        (mode === MODES.ADMIN && !isAdmin(socket)) ||
        (mode === MODES.LOCKDOWN && !isLockdownAdmin(socket))
      ) {
        throw new Error('Admins only');
      }
      const fallbackTargetId = Array.from(rovers.keys()).find(
        (id) => canRequestControl(id, socket, { allowUser: true }).ok,
      );
      const targetId = roverId || fallbackTargetId;
      if (!targetId) {
        throw new Error('No rovers available');
      }
      const previousJoined = getRoversForSocket(socket.id);
      if (!isAdmin(socket)) {
        const { ok, message } = canSwitchRover(socket, targetId);
        if (!ok) {
          throw new Error(message || 'Switch denied');
        }
      }
      const forceAllowed = Boolean(force) && isAdmin(socket);
      logger.info('Request control', socket.id, targetId, { force: forceAllowed });
      requestControl(targetId, socket, { force: forceAllowed, allowUser: true });
      previousJoined.forEach((rid) => {
        if (rid !== targetId) {
          releaseControl(rid, socket);
        }
      });
      videoSessions.revokeWhere(
        (info) =>
          info.socketId === socket.id &&
          info.sourceType === 'rover' &&
          info.sourceId !== targetId &&
          info.sourceId !== `${targetId}-audio`,
      );
      managerEvents.emit('switch', { socketId: socket.id, roverId: targetId });
      socket.emit('controlGranted', { roverId: targetId });
      cb({ success: true, roverId: targetId });
    } catch (err) {
      logger.warn('Request control failed', socket.id, err.message);
      sendAlert({ color: ALERT_COLOR, title: 'Control denied', message: err.message });
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
    const record = rovers.get(roverId);
    if (!record) {
      cb({ error: 'Unknown rover' });
      return;
    }
    const isPrivate = isPrivateRecord(record);
    if (isPrivate && !isLockdownAdmin(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    if (!isPrivate && !isAdmin(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      if (isPrivate) {
        const open = !Boolean(locked);
        setPrivateOpen(roverId, open, { reason: 'manual' });
        logger.info('Private state changed', roverId, { open });
      } else {
        lockRover(roverId, locked, { reason: 'manual' });
        logger.info('Lock state changed', roverId, locked);
      }
      cb({ success: true });
    } catch (err) {
      logger.warn('Lock change failed', roverId, err.message);
      sendAlert({ color: ALERT_COLOR, title: 'Lock failed', message: err.message });
      cb({ error: err.message });
    }
  }

  function handlePrivateSafetySet({ roverId, safety } = {}, cb = () => {}) {
    const record = rovers.get(roverId);
    if (!record) {
      cb({ error: 'Unknown rover' });
      return;
    }
    if (!isPrivateRecord(record)) {
      cb({ error: 'Rover is not private' });
      return;
    }
    if (!isLockdownAdmin(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      const next = setPrivateSafety(roverId, safety || {}, { reason: 'manual' });
      cb({ success: true, safety: next });
    } catch (err) {
      cb({ error: err.message });
    }
  }

  function handleSubscribeAll(_, cb = () => {}) {
    if (socket.data?.role !== 'spectator') {
      cb({ error: 'Spectator role required' });
      return;
    }
    if (getMode() === MODES.LOCKDOWN) {
      cb({ error: 'Spectating disabled in lockdown' });
      return;
    }
    logger.info('Spectator subscribing to all rovers', socket.id);
    for (const record of rovers.values()) {
      if (isRoverVisibleToSocket(record, socket)) {
        socket.join(record.room);
      } else {
        socket.leave(record.room);
      }
    }
    cb({ success: true });
  }

  socket.on('requestControl', handleRequestControl);
  socket.on('session:requestControl', handleRequestControl);
  socket.on('releaseControl', handleReleaseControl);
  socket.on('session:releaseControl', handleReleaseControl);
  socket.on('lockRover', handleLockToggle);
  socket.on('session:lockRover', handleLockToggle);
  socket.on('privateSafety:set', handlePrivateSafetySet);
  socket.on('session:privateSafety:set', handlePrivateSafetySet);
  socket.on('subscribeAll', handleSubscribeAll);
  socket.on('session:subscribeAll', handleSubscribeAll);

  socket.on('disconnecting', () => {
    logger.info('Socket disconnecting', socket.id);
    removeSocket(socket);
    tickPrivateAutoClose();
  });
  socket.on('disconnect', () => {
    logger.info('Socket disconnected', socket.id);
    removeSocket(socket);
    tickPrivateAutoClose();
  });
});

function enableSpectator(socket) {
  if (!socket?.id || spectatorSockets.has(socket.id)) return;
  spectatorSockets.add(socket.id);
  for (const record of rovers.values()) {
    if (isRoverVisibleToSocket(record, socket)) {
      socket.join(record.room);
    } else {
      socket.leave(record.room);
    }
  }
}

function disableSpectator(socket) {
  if (!socket?.id || !spectatorSockets.has(socket.id)) return;
  spectatorSockets.delete(socket.id);
  for (const record of rovers.values()) {
    socket.leave(record.room);
  }
}

function tickPrivateAutoClose() {
  const now = Date.now();
  const onlineCount = io.sockets.sockets.size;
  for (const record of rovers.values()) {
    if (!isPrivateRecord(record) || !isPrivateOpen(record)) {
      privateNoUsersSince.delete(record.id);
      continue;
    }
    if (onlineCount > 0) {
      privateNoUsersSince.delete(record.id);
      continue;
    }
    const since = privateNoUsersSince.get(record.id) || now;
    if (!privateNoUsersSince.has(record.id)) {
      privateNoUsersSince.set(record.id, since);
      continue;
    }
    if (now - since >= PRIVATE_AUTO_CLOSE_IDLE_MS) {
      try {
        setPrivateOpen(record.id, false, { reason: 'auto_idle', tts: true });
      } catch (err) {
        logger.warn('Private auto-close failed', { roverId: record.id, error: err.message });
      }
      privateNoUsersSince.delete(record.id);
    }
  }
}

setInterval(tickPrivateAutoClose, PRIVATE_AUTO_CLOSE_TICK_MS);
