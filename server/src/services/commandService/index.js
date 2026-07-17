// command Service
// Purpose: Defines the command Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const { v4: uuidv4 } = require('uuid');
const io = require('../../globals/io');
const roverManager = require('../roverManager');
const { isAdmin, isLockdownAdmin } = require('../roleService');
const { isDeterred } = require('../verificationService');
const logger = require('../../globals/logger').child('commandService');
const { isHeadlightBlocked } = require('../../rewards/definitions/darkness');
const homeAssistantService = require('../homeAssistantService');
const overcurrentProtectionService = require('../overcurrentProtectionService');

const pendingCommands = new Map(); // id -> { roverId }
const lastDriveActivity = new Map(); // roverId -> { ts, socketId, direction, speed, isAdmin }
const driveCooldowns = new Map(); // roverId -> blockedUntil
let roomLightsWereLockedOn = Boolean(homeAssistantService.getLightPolicyState?.()?.lockedOn);

function isRoomLightsLockedOn() {
  return Boolean(homeAssistantService.getLightPolicyState?.()?.lockedOn);
}

function getLaserAction(payload = {}) {
  return String(payload?.laser?.action || 'toggle').trim().toLowerCase() || 'toggle';
}

function isLaserCommandBlockedByRoomLightLock(payload = {}) {
  if (!isRoomLightsLockedOn()) return false;
  // A locked-on room-light policy means the laser must not emit. Explicit off
  // commands are still allowed so cleanup paths can force a safe state.
  return getLaserAction(payload) !== 'off';
}

function forceAllRoverLasersOff(reason) {
  const attempted = [];
  const failed = [];
  roverManager.rovers.forEach((record) => {
    if (!record?.ws || !record?.meta?.laser?.enabled) return;
    const roverId = String(record.id);
    try {
      issueCommand(roverId, {
        type: 'laser',
        laser: { action: 'off' },
      });
      attempted.push(roverId);
    } catch (err) {
      failed.push({ roverId, error: err.message });
    }
  });
  if (attempted.length || failed.length) {
    logger.info('Forced rover lasers off', { reason, attempted, failed });
  }
}

function enforceLaserRoomLightLock(reason) {
  if (!isRoomLightsLockedOn()) return;
  forceAllRoverLasersOff(reason);
}

function normalizeOutboundCommandPayload(payload = {}) {
  if (payload?.type !== 'tts') return payload;

  const tts = payload.tts && typeof payload.tts === 'object' ? payload.tts : {};
  const configuredEngine = typeof tts.engine === 'string' ? tts.engine.trim() : '';
  if (configuredEngine) return payload;

  // The server owns the default for commands it sends. Roverd still keeps its
  // own local default for payloads that omit an engine from some other source,
  // but normal server-issued TTS should prefer Google speech without requiring
  // every caller to remember that policy.
  return {
    ...payload,
    tts: {
      ...tts,
      engine: 'chromegtts',
    },
  };
}

function issueCommand(roverId, payload) {
  const record = roverManager.rovers.get(roverId);
  if (!record || !record.ws) {
    throw new Error('Rover offline');
  }
  if (payload?.type === 'laser' && isLaserCommandBlockedByRoomLightLock(payload)) {
    throw new Error('Laser disabled while room lights are locked on');
  }
  const id = uuidv4();
  const normalizedPayload = normalizeOutboundCommandPayload(payload);
  const message = { ...normalizedPayload, id };
  record.ws.send(JSON.stringify(message));
  pendingCommands.set(id, { roverId, ts: Date.now(), type: normalizedPayload.type });
  logger.info('Issued command', roverId, normalizedPayload.type, id);
  return id;
}

/*
  The protection service owns decisions about when a held command must be
  resent at a lower output. Injecting this raw transport function keeps those
  resends on the same rover websocket path as every other server command while
  avoiding a circular dependency from the protection service back into this
  socket-facing module.
*/
overcurrentProtectionService.configureCommandIssuer((roverId, payload) => {
  const blockedUntil = driveCooldowns.get(roverId);
  const safetyCooldownActive = blockedUntil && Date.now() < blockedUntil;
  if (safetyCooldownActive && getCommandMotionMagnitude(payload?.type, payload) > 0) {
    /*
      Private-rover and dock safety own the existing command cooldown map. A
      rate-limited protection resend must respect those independent systems;
      otherwise this new service could restart drive or brushes immediately
      after an unrelated safety feature deliberately stopped them. Returning
      false tells the protection service to retry after the cooldown instead of
      recording an output that never reached the rover.
    */
    return false;
  }
  issueCommand(roverId, payload);
  return true;
});

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

function issueUpdateToAllRovers() {
  const updated = [];
  const failed = [];

  roverManager.rovers.forEach((record) => {
    if (!record?.ws) return;

    const roverId = String(record.id);
    try {
      // Use the same narrow update payload as the per-rover admin action. The
      // browser only asks for "update all"; the Pi still owns the privileged
      // pull/install/reboot sequence through its fixed self-update helper.
      issueCommand(roverId, { type: 'update', update: {} });
      updated.push(roverId);
    } catch (err) {
      failed.push({ roverId, error: err.message });
    }
  });

  return { updated, failed };
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

function getCommandMotionMagnitude(type, payload = {}) {
  if (type === 'drive') {
    const driveDirect = payload?.driveDirect || {};
    const left = Math.abs(Number(driveDirect.left) || 0);
    const right = Math.abs(Number(driveDirect.right) || 0);
    return Math.max(left, right);
  }

  if (type === 'motors') {
    const motorPwm = payload?.motorPwm || {};
    const main = Math.abs(Number(motorPwm.main) || 0);
    const side = Math.abs(Number(motorPwm.side) || 0);
    const vacuum = Math.abs(Number(motorPwm.vacuum) || 0);
    return Math.max(main, side, vacuum);
  }

  return 0;
}

function shouldRecordTurnActivity(type, payload = {}) {
  /*
    The turn idle-skip timer is a user-intent timer, not a generic command timer.
    Some commands are emitted by the browser as setup/cleanup work while the
    driver is literally doing nothing. Counting those commands as activity lets
    a totally idle client keep a turn forever, because recordActivity disarms
    the idle skip for the rest of that turn.
  */
  if (type === 'sensorStream') {
    /*
      Sensor streaming is enabled automatically when the UI has a rover
      assignment and can also be resent after harmless React/session churn.
      It is not proof that the driver touched a control.
    */
    return false;
  }

  if (type === 'drive' || type === 'motors') {
    /*
      Zero drive/motor packets are safety cleanup packets. The keyboard manager,
      gamepad manager, blur handlers, and turn transitions can all send zeros
      without human intent, so only non-zero motion should disarm idle skip.
    */
    return getCommandMotionMagnitude(type, payload) > 0;
  }

  if (type === 'horn') {
    /*
      Starting the horn is a deliberate action. Stopping it can be automatic
      after a timeout or key release, so the stop packet should not be the event
      that proves the driver is active.
    */
    return payload?.horn?.action !== 'stop';
  }

  /*
    Other accepted commands are left as activity because they are tied to an
    explicit user control: servo moves, headlight/laser toggles, raw OI commands,
    songs, reboot/update admin actions, and similar commands.
  */
  return true;
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
      let payload = data ? { ...data } : {};
      if (type === 'headlight' && isHeadlightBlocked()) {
        logger.info('Ignoring headlight command while darkness lock is active', { socketId: socket.id, roverId });
        reply({ ignored: true, reason: 'darknessActive' });
        return;
      }
      if (type === 'laser' && isLaserCommandBlockedByRoomLightLock(payload)) {
        logger.info('Ignoring laser command while room lights are locked on', {
          socketId: socket.id,
          roverId,
          action: getLaserAction(payload),
        });
        reply({ ignored: true, reason: 'roomLightsLockedOn' });
        return;
      }
      const isRebootCommand = type === 'reboot';
      const isUpdateCommand = type === 'update';
      const isSongCommand = type === 'song' || (type === 'raw' && isSongRawPayload(payload));
      const isAdminSocket = isAdmin(socket);
      if (!isAdminSocket && isDeterred(socket)) {
        throw new Error('Not authorized');
      }
      // Rover updates run a privileged, root-owned helper on the Pi. Keep this
      // in the same explicit admin-only branch as reboot instead of relying on
      // drive ownership checks, because having a turn should not grant system
      // maintenance privileges.
      if ((isRebootCommand || isUpdateCommand) && !isAdminSocket) {
        throw new Error('Not authorized');
      }
      if (!isSongCommand && !isRebootCommand && !isUpdateCommand && !roverManager.canDrive(roverId, socket)) {
        throw new Error('Not your turn or no control');
      }
      const driveDirect = payload?.driveDirect;
      if (type === 'drive' && driveDirect) {
        if (!isAdminSocket) {
          const safeDrive = roverManager.applyPrivateDriveSafety(roverId, socket, driveDirect);
          if (safeDrive) {
            payload.driveDirect = safeDrive;
          }
        }
        const left = Number(payload?.driveDirect?.left);
        const right = Number(payload?.driveDirect?.right);
        const speed = Math.max(Math.abs(left), Math.abs(right));
        if (!isAdminSocket) {
          const blockedUntil = driveCooldowns.get(roverId);
          if (blockedUntil && Date.now() < blockedUntil && speed > 0) {
            const reason = isLockdownAdmin(socket)
              ? 'Drive blocked: cooldown'
              : 'Drive blocked: safety cooldown';
            throw new Error(reason);
          }
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

      if (type === 'drive' || type === 'motors') {
        /*
          Role is supplied at the command boundary because telemetry does not
          identify the operator who produced the active motor intent. Admin and
          lockdown commands therefore enter the service explicitly bypassed;
          they are recorded for status visibility but are never scaled, blocked,
          or countermanded by a later sensor frame.
        */
        payload = overcurrentProtectionService.protectCommand(roverId, type, payload, {
          bypassed: isAdminSocket,
        });
      }
      const id = issueCommand(roverId, { type, ...payload });
      logger.info('Queued command', socket.id, roverId, type);
      if (shouldRecordTurnActivity(type, payload)) {
        try {
          const { recordActivity } = require('../turnService');
          recordActivity(roverId, socket.id);
        } catch (err) {
          // Activity recording is best-effort because command delivery should not fail if turn bookkeeping has a transient issue.
        }
      }
      reply({ id });
    } catch (err) {
      logger.warn('Command rejected', socket.id, err.message);
      reply({ error: err.message });
    }
  }

  socket.on('command', handleCommand);
  socket.on('command:issue', handleCommand);

  socket.on('command:updateAllRovers', (_payload = {}, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    try {
      if (!isAdmin(socket)) {
        throw new Error('Not authorized');
      }

      const result = issueUpdateToAllRovers();
      logger.warn('Admin requested update for all online rovers', {
        socketId: socket.id,
        updated: result.updated,
        failed: result.failed,
      });
      reply(result);
    } catch (err) {
      logger.warn('Update-all rovers rejected', socket.id, err.message);
      reply({ error: err.message });
    }
  });
});

homeAssistantService.homeAssistantEvents.on('update', () => {
  const lockedOn = isRoomLightsLockedOn();
  if (lockedOn && !roomLightsWereLockedOn) {
    enforceLaserRoomLightLock('roomLightsLockedOn');
  }
  roomLightsWereLockedOn = lockedOn;
});

roverManager.managerEvents.on('rover', (event = {}) => {
  // A rover can reconnect with laser.initialOn enabled or stale hardware state.
  // When room lights are locked on, every newly upserted rover gets an explicit
  // off command so the lock policy is true even across reconnects.
  if (event.action === 'upsert') {
    enforceLaserRoomLightLock('roverUpsertWhileRoomLightsLockedOn');
  }
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
