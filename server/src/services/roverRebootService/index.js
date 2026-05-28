// rover Reboot Service
// Purpose: Handles one-shot user-triggered rover reboot requests with server-side safety checks.
// Scope: Validates ownership/control, stops the rover, issues reboot, and publishes admin-alert events.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('roverReboot');
const { getRole } = require('../roleService');
const roverManager = require('../roverManager');
const assignmentService = require('../assignmentService');
const { stopRover } = require('../turnService/actions');
const { issueCommand } = require('../commandService');
const { publishEvent } = require('../eventBus');

const USER_COOLDOWN_MS = 2 * 60 * 1000;
const userCooldowns = new Map(); // socketId -> blockedUntil

function getCooldownLeftMs(socketId) {
  const blockedUntil = Number(userCooldowns.get(socketId) || 0);
  return Math.max(0, blockedUntil - Date.now());
}

function setCooldown(socketId) {
  userCooldowns.set(socketId, Date.now() + USER_COOLDOWN_MS);
}

function canRequestReboot(socket) {
  if (!socket?.id) throw new Error('Socket required');
  const role = getRole(socket);
  if (role === 'spectator') throw new Error('Spectators cannot reboot rovers');
  const roverId = assignmentService.getAssignedRover(socket.id);
  if (!roverId) throw new Error('No assigned rover');
  const record = roverManager.rovers.get(String(roverId));
  if (!record || !record.ws) throw new Error('Assigned rover is offline');
  if (!roverManager.canDrive(roverId, socket)) throw new Error('Not your turn or no control');
  if (!(record.drivers instanceof Set) || record.drivers.size !== 1 || !record.drivers.has(socket.id)) {
    throw new Error('Reboot blocked while other drivers are connected');
  }
  const cooldownLeftMs = getCooldownLeftMs(socket.id);
  if (cooldownLeftMs > 0) {
    throw new Error(`Reboot cooldown active (${Math.ceil(cooldownLeftMs / 1000)}s)`);
  }
  return { roverId: String(roverId), record };
}

io.on('connection', (socket) => {
  function handleRebootOwnRover(_, cb = () => {}) {
    try {
      const { roverId, record } = canRequestReboot(socket);
      stopRover(roverId);
      issueCommand(roverId, { type: 'reboot', reboot: { delayMs: 300 } });
      setCooldown(socket.id);
      const requester = socket?.data?.user?.username || socket.id;
      publishEvent({
        source: 'roverRebootService',
        type: 'rover.reboot.userRequested',
        payload: {
          roverId,
          roverName: record?.meta?.name || roverId,
          by: requester,
        },
      });
      logger.info('User-requested rover reboot', { roverId, by: requester, socketId: socket.id });
      cb({ success: true, roverId });
    } catch (err) {
      cb({ error: err.message || 'Reboot failed' });
    }
  }

  socket.on('session:rebootOwnRover', handleRebootOwnRover);
  socket.on('rebootOwnRover', handleRebootOwnRover);

  socket.on('disconnect', () => {
    userCooldowns.delete(socket.id);
  });
});

module.exports = {};
