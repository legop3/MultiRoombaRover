// Server-owned docking operations.
const { v4: uuidv4 } = require('uuid');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('dockingService');
const states = new WeakMap();
const intents = new Set(['enterDocking', 'cancelDocking', 'undock']);
const ASSIST_SPEED = 60;
const SENSOR_TIMEOUT_MS = 1500;
const UNDOCK_TIMEOUT_MS = 4000;
const REVERSE_TIMEOUT_MS = 1000;
// Preserve the working OI preparation sequence; only backing away is sensor-driven.
const MODE_COMMAND_DELAY_MS = 100;
const FULL_MODE_SETTLE_MS = 300;

function stateFor(record) {
  if (!states.has(record)) {
    states.set(record, {
      contact: null, charging: false, latched: false, assist: false,
      operation: null, error: null, seenAt: 0, timer: null, contactDockPending: false,
    });
  }
  return states.get(record);
}

function snapshot(record) {
  const state = stateFor(record);
  return {
    phase: state.operation ? 'undocking' : state.contact ? (state.charging ? 'charging' : 'docked') : state.assist ? 'assisting' : 'idle',
    movementLocked: Boolean(state.operation || state.latched || state.error || state.contact == null),
    cameraLocked: state.assist,
    error: state.error,
  };
}

function publish(record) {
  if (!record.lastSensor?.decoded) return;
  record.lastSensor.decoded = { ...record.lastSensor.decoded, docking: snapshot(record) };
  // State transitions use the same telemetry event, including failures when the
  // physical sensor stream has stalled. Never manufacture a new sensor timestamp.
  io.to(record.room).emit('sensorFrame', {
    roverId: record.id, frame: record.lastSensor.raw, sensors: record.lastSensor.decoded,
    overcurrentProtection: record.lastOvercurrentProtection || null,
  });
}

function send(record, payload) {
  return require('../commandService').issueCommand(record.id, payload, { dockingOwned: true });
}
function stop(record) {
  // Forget the previous held intent so protection cannot replay it after unlock.
  require('../overcurrentProtectionService').protectCommand(record.id, 'drive', { driveDirect: { left: 0, right: 0 } });
  send(record, { type: 'drive', driveDirect: { left: 0, right: 0 } });
}
function stopAllMotion(record) {
  stop(record);
  const payload = { motorPwm: { main: 0, side: 0, vacuum: 0 } };
  require('../overcurrentProtectionService').protectCommand(record.id, 'motors', payload);
  send(record, { type: 'motors', ...payload });
}
function mode(record, opcode) {
  send(record, { type: 'raw', raw: Buffer.from([opcode]).toString('base64') });
}
function camera(record, angle) {
  if (record.meta?.cameraServo?.enabled) send(record, { type: 'servo', servo: { angle } });
}
function song(record, notes, slot = 0, duration = 10) {
  send(record, { type: 'song', song: { slot, notes: notes.map((note) => ({ note, duration })) } });
}
function finishAssist(record, { playExitSong = true } = {}) {
  const state = stateFor(record);
  if (!state.assist) return;
  state.assist = false;
  camera(record, 0);
  if (playExitSong) song(record, [83, 76]);
}
function clearOperation(state) {
  clearTimeout(state.timer);
  state.timer = null;
  state.operation = null;
}
function fail(record, code, message) {
  const state = stateFor(record);
  clearOperation(state);
  state.error = { code, message };
  state.latched = true;
  try { stop(record); } catch (error) {
    logger.warn('Unable to stop docking operation', { roverId: record.id, error: error.message });
  }
  publish(record);
}
function armDeadline(record) {
  const state = stateFor(record);
  clearTimeout(state.timer);
  if (!state.operation) return;
  const deadline = Math.min(
    state.seenAt + SENSOR_TIMEOUT_MS,
    state.operation.startedAt + UNDOCK_TIMEOUT_MS,
    state.operation.reversingAt ? state.operation.reversingAt + REVERSE_TIMEOUT_MS : Infinity,
  );
  state.timer = setTimeout(() => {
    const stale = Date.now() - state.seenAt >= SENSOR_TIMEOUT_MS;
    fail(record, stale ? 'telemetryUnavailable' : 'undockTimeout', stale ? 'Rover telemetry stopped during undocking.' : 'Unable to leave the dock.');
  }, Math.max(1, deadline - Date.now()));
  state.timer.unref?.();
}

function handleIntent(record, type, payload, socket) {
  const state = stateFor(record);
  if (type === 'cancelDocking') {
    if (state.operation) fail(record, 'undockCancelled', 'Undocking stopped.');
    stop(record);
    finishAssist(record);
    publish(record);
    return;
  }
  state.error = null;
  state.contactDockPending = false;
  require('../roverManager').stopDockGuard(record.id);
  stop(record);
  if (type === 'enterDocking') {
    state.latched = false;
    if (!state.assist) {
      state.assist = true;
      camera(record, record.meta?.cameraServo?.minAngle ?? -45);
      song(record, [76, 83]);
    }
  } else {
    finishAssist(record);
    camera(record, 0);
    state.operation = {
      startedAt: Date.now(), socket, backoff: payload.backoff !== false, reversing: false,
      stage: 'start', nextStepAt: Date.now() + MODE_COMMAND_DELAY_MS,
    };
    mode(record, 128);
    armDeadline(record);
  }
  publish(record);
}

function processTelemetry(record, sensors) {
  const state = stateFor(record);
  if (!sensors?.chargingSources || !sensors?.oiMode) return snapshot(record);
  const previousContact = state.contact;
  state.seenAt = Date.now();
  state.contact = Boolean(sensors.chargingSources.homeBase);
  state.charging = [1, 2, 3, 4].includes(sensors.chargingState?.code);
  if (previousContact == null) state.latched = state.contact;
  try {
    const operation = state.operation;
    if (operation) {
      const manager = require('../roverManager');
      if (!operation.socket?.connected || !manager.canDrive(record.id, operation.socket)) {
        fail(record, 'controlLost', 'Undocking stopped because control changed.');
      } else if (Date.now() - operation.startedAt >= UNDOCK_TIMEOUT_MS
        || (operation.reversingAt && Date.now() - operation.reversingAt >= REVERSE_TIMEOUT_MS)) {
        fail(record, 'undockTimeout', 'Unable to leave the dock.');
      } else if (Date.now() < operation.nextStepAt) {
        // Advance only on fresh telemetry, after the previous OI command settles.
      } else if (operation.stage === 'start') {
        mode(record, 143);
        operation.stage = 'dock';
        operation.nextStepAt = Date.now() + MODE_COMMAND_DELAY_MS;
      } else if (operation.stage === 'dock') {
        mode(record, 132);
        operation.stage = 'full';
        operation.nextStepAt = Date.now() + FULL_MODE_SETTLE_MS;
      } else if (sensors.oiMode.label === 'full') {
        if (!state.contact || !operation.backoff) {
          stop(record);
          clearOperation(state);
          state.latched = state.contact;
        } else if (!operation.reversing) {
          operation.reversing = true;
          operation.reversingAt = Date.now();
          const speed = Math.max(1, Math.min(500, Number(record.meta?.maxWheelSpeed) || 500));
          // Track the controller's own intent in existing protection so stalls
          // still stop it and subsequent adjustments refer to this reverse only.
          const drive = require('../overcurrentProtectionService').protectCommand(record.id, 'drive', {
            driveDirect: { left: -speed, right: -speed },
          }, { bypassed: require('../roleService').isAdmin(operation.socket) });
          if (!drive.driveDirect.left && !drive.driveDirect.right) throw new Error('Undocking blocked by wheel protection');
          send(record, { ...drive, type: 'drive' });
        }
      } else if (operation.reversing) {
        fail(record, 'modeChanged', 'Undocking stopped because the Roomba mode changed.');
      }
      armDeadline(record);
    } else if (state.contact) {
      state.latched = true;
      if (previousContact !== true) {
        stopAllMotion(record);
        state.contactDockPending = true;
        if (state.assist) song(record, [84], 1, 6);
      } else if (state.contactDockPending && !state.charging) {
        const speeds = sensors.wheelSpeedsMmPerSecond;
        // A stop request does not prove the wheels stopped on the contacts.
        // Require a subsequent frame with contact and measured stationary wheels.
        if (speeds?.left === 0 && speeds?.right === 0) {
          mode(record, 143);
          state.contactDockPending = false;
        }
      }
      if (state.charging) {
        state.contactDockPending = false;
        // An immediate exit song would replace the contact beep on the Roomba.
        finishAssist(record, { playExitSong: false });
      }
    } else {
      state.contactDockPending = false;
      if (previousContact === true && state.assist) song(record, [72], 1, 6);
    }
  } catch (error) {
    fail(record, 'commandFailed', error.message);
  }
  return snapshot(record);
}

function shouldIgnoreDriveInput(record, payload) {
  if (!stateFor(record).operation) return false;
  if (payload.driveDirect) return true;
  const raw = payload.raw ? Buffer.from(payload.raw, 'base64') : null;
  return Boolean(raw && [137, 145].includes(raw[0]));
}

function protectCommand(record, payload, { dockingOwned = false } = {}) {
  if (dockingOwned) return payload;
  const state = stateFor(record);
  // Raw OI drive packets must obey the same movement lock. Other raw commands,
  // including mode changes, remain available and can interrupt the operation.
  const raw = payload.raw ? Buffer.from(payload.raw, 'base64') : null;
  if (state.operation && raw && [128, 131, 132, 133, 134, 135, 136, 143].includes(raw[0])) {
    // Explicit mode commands remain available and take precedence over an
    // automatic sequence, including while it is still waiting for full mode.
    fail(record, 'modeChanged', 'Undocking stopped by a Roomba mode command.');
  }
  if (raw && [137, 145].includes(raw[0])) {
    if (raw.length !== 5) throw new Error('Invalid raw drive command');
    const first = raw.readInt16BE(1);
    const second = raw.readInt16BE(3);
    if (raw[0] === 137 && first !== 0 && state.assist && !snapshot(record).movementLocked) {
      const limited = Buffer.from(raw);
      limited.writeInt16BE(Math.max(-ASSIST_SPEED, Math.min(ASSIST_SPEED, first)), 1);
      return { ...payload, raw: limited.toString('base64') };
    }
    if (raw[0] === 145) {
      return protectCommand(record, { type: 'drive', driveDirect: { left: second, right: first } });
    }
    if (first === 0 && state.operation) fail(record, 'undockStopped', 'Undocking stopped by a stop command.');
    if (first !== 0 && snapshot(record).movementLocked) throw new Error('Drive blocked while docked or undocking');
  }
  // User drive input is discarded at submitCommand before reaching here.
  // Internal safety stops still interrupt the controller through this path.
  if (payload.driveDirect) {
    const { left, right } = payload.driveDirect;
    if (!Number(left) && !Number(right) && state.operation) {
      fail(record, 'undockStopped', 'Undocking stopped by a stop command.');
    }
    if ((Number(left) || Number(right)) && snapshot(record).movementLocked) throw new Error('Drive blocked while docked or undocking');
    if (state.assist) {
      const scale = Math.min(1, ASSIST_SPEED / Math.max(Math.abs(left), Math.abs(right), 1));
      return { ...payload, driveDirect: { left: Math.round(left * scale), right: Math.round(right * scale) } };
    }
  }
  if (payload.servo && state.assist) throw new Error('Camera locked during dock assist');
  return payload;
}

function disconnect(record) {
  const state = stateFor(record);
  if (state.operation) fail(record, 'roverDisconnected', 'Rover disconnected during undocking.');
  clearOperation(state);
  state.seenAt = 0;
  state.contact = null;
  state.assist = false;
}

function canAdjustReverse(record) {
  return Boolean(record && stateFor(record).operation?.reversing);
}

function issueIntent(record, type, payload, socket) {
  const state = stateFor(record);
  // Validate before mutating, so duplicate/rejected requests cannot disturb an
  // operation that is already in progress.
  if (type !== 'cancelDocking') {
    if (state.operation) throw new Error('Undocking is already in progress');
    if (Date.now() - state.seenAt >= SENSOR_TIMEOUT_MS || state.contact == null) {
      throw new Error('Waiting for current rover telemetry');
    }
    // Already at the requested destination; acknowledge without restarting assist.
    if (type === 'enterDocking' && state.contact) return uuidv4();
  }
  const id = uuidv4();
  try {
    handleIntent(record, type, payload, socket);
  } catch (error) {
    fail(record, 'commandFailed', error.message);
    throw error;
  }
  return id;
}
module.exports = { shouldIgnoreDriveInput, canAdjustReverse, snapshot, intents, issueIntent, processTelemetry, protectCommand, disconnect };
