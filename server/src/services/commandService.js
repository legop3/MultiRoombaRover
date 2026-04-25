const { v4: uuidv4 } = require('uuid');
const io = require('../globals/io');
const roverManager = require('./roverManager');
const { isAdmin, isLockdownAdmin } = require('./roleService');
const { isDeterred } = require('./verificationService');
const logger = require('../globals/logger').child('commandService');
const { isNightVisionBlocked } = require('../rewards/definitions/darkness');

const pendingCommands = new Map(); // id -> { roverId }
const lastDriveActivity = new Map(); // roverId -> { ts, socketId, direction, speed, isAdmin }
const driveCooldowns = new Map(); // roverId -> blockedUntil

function issueCommand(roverId, payload) {
  const record = roverManager.rovers.get(roverId);
  if (!record || !record.ws) {
    throw new Error('Rover offline');
  }
  const id = uuidv4();
  const message = { ...payload, id };
  record.ws.send(JSON.stringify(message));
  pendingCommands.set(id, { roverId, ts: Date.now(), type: payload.type });
  logger.info('Issued command', roverId, payload.type, id);
  return id;
}

function handleAck(msg) {
  const pending = pendingCommands.get(msg.id);
  if (!pending) return;
  pendingCommands.delete(msg.id);
  logger.info('Command acknowledged', pending.roverId, pending.type, msg.status);
  io.emit('commandAck', {
    roverId: pending.roverId,
    id: msg.id,
    status: msg.status || 'ok',
    error: msg.error,
  });
}

function getRecentDriveActivity(windowMs, options = {}) {
  const now = Date.now();
  const results = [];
  for (const [roverId, info] of lastDriveActivity.entries()) {
    if (!info || now - info.ts > windowMs) continue;
    if (options.excludeAdmins && info.isAdmin) continue;
    results.push({ roverId, ...info });
  }
  return results;
}

function setDriveCooldown(roverId, durationMs) {
  if (!roverId || !durationMs) return;
  driveCooldowns.set(roverId, Date.now() + durationMs);
}

module.exports = {
  issueCommand,
  handleAck,
  getRecentDriveActivity,
  setDriveCooldown,
};

io.on('connection', (socket) => {
  function handleCommand({ roverId, type, data } = {}, cb) {
    const reply = typeof cb === 'function' ? cb : () => {};
    try {
      if (!roverId) {
        throw new Error('roverId required');
      }
      if (!type) {
        throw new Error('type required');
      }
      if (type === 'audioLevels') {
        throw new Error('audioLevels command is service-managed');
      }
      if (type === 'nightVision' && isNightVisionBlocked()) {
        logger.info('Ignoring night vision command while darkness lock is active', { socketId: socket.id, roverId });
        reply({ ignored: true, reason: 'darknessActive' });
        return;
      }
      const payload = data ? { ...data } : {};
      const isRebootCommand = type === 'reboot';
      const isSongCommand = type === 'song' || (type === 'raw' && isSongRawPayload(payload));
      const isAdminSocket = isAdmin(socket);
      if (!isAdminSocket && isDeterred(socket)) {
        throw new Error('Not authorized');
      }
      if (isRebootCommand && !isAdminSocket) {
        throw new Error('Not authorized');
      }
      if (!isSongCommand && !isRebootCommand && !roverManager.canDrive(roverId, socket)) {
        throw new Error('Not your turn or no control');
      }
      const driveDirect = payload?.driveDirect;
      if (type === 'drive' && driveDirect && !isAdminSocket) {
        const safeDrive = roverManager.applyPrivateDriveSafety(roverId, socket, driveDirect);
        if (safeDrive) {
          payload.driveDirect = safeDrive;
        }
        const left = Number(payload?.driveDirect?.left);
        const right = Number(payload?.driveDirect?.right);
        const speed = Math.max(Math.abs(left), Math.abs(right));
        const blockedUntil = driveCooldowns.get(roverId);
        if (blockedUntil && Date.now() < blockedUntil && speed > 0) {
          const reason = isLockdownAdmin(socket)
            ? 'Drive blocked: cooldown'
            : 'Drive blocked: safety cooldown';
          throw new Error(reason);
        }
        if (speed > 0) {
          let direction = 'turn';
          if (left > 0 && right > 0) direction = 'forward';
          if (left < 0 && right < 0) direction = 'backward';
          lastDriveActivity.set(roverId, {
            ts: Date.now(),
            socketId: socket.id,
            direction,
            speed,
            isAdmin: isAdminSocket,
          });
        }
      }
      const id = issueCommand(roverId, { type, ...payload });
      logger.info('Queued command', socket.id, roverId, type);
      try {
        const { recordActivity } = require('./turnService');
        recordActivity(roverId, socket.id);
      } catch (err) {
        // best effort; ignore activity update errors
      }
      reply({ id });
    } catch (err) {
      logger.warn('Command rejected', socket.id, err.message);
      reply({ error: err.message });
    }
  }

  socket.on('command', handleCommand);
  socket.on('command:issue', handleCommand);
});

function isSongRawPayload(payload) {
  if (!payload) return false;
  const raw = payload.raw;
  if (!raw) return false;
  let bytes = null;
  if (Buffer.isBuffer(raw)) {
    bytes = raw;
  } else if (Array.isArray(raw)) {
    bytes = Buffer.from(raw);
  } else if (typeof raw === 'string') {
    bytes = Buffer.from(raw, 'base64');
  }
  if (!bytes || bytes.length === 0) return false;
  const opcode = bytes[0];
  return opcode === 140 || opcode === 141;
}
