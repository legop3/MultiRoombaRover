// The server owns assist presentation and authorization; the rover owns motion.
const states = new WeakMap();
const intents = new Set(['enterDocking', 'dockAssist', 'autoDock', 'cancelDocking', 'undock']);
function stateFor(record) {
  if (!states.has(record)) states.set(record, { assist: false, operation: null, error: null });
  return states.get(record);
}
function snapshot(record) {
  const local = stateFor(record), state = record.roverState;
  return {
    phase: local.operation ? 'undocking' : state?.docked === true ? (state.battery?.charging ? 'charging' : 'docked') : local.assist ? 'assisting' : state?.docking ? 'seeking' : 'idle',
    movementLocked: Boolean(local.operation || local.error || state?.docked !== false || state?.drivingMode !== true),
    cameraLocked: local.assist, error: local.error,
  };
}
function publish(record) {
  require('../../globals/io').to(record.room).emit('dockingState', { roverId: record.id, docking: snapshot(record) });
}
function send(record, payload) { return require('../commandService').issueCommand(record.id, payload, { dockingOwned: true }); }
function camera(record, angle) {
  if (record.meta?.cameraServo?.enabled) send(record, { type: 'servo', servo: { angle } });
}
function finish(record, error = null) {
  const state = stateFor(record);
  if (state.operation) clearTimeout(state.operation.timer);
  state.operation = null; state.error = error;
  publish(record);
}
function issueIntent(record, type, payload, socket) {
  const state = stateFor(record);
  if (type === 'enterDocking') type = 'dockAssist';
  if (state.operation && type !== 'cancelDocking') throw new Error('Undocking is already in progress');
  if (type === 'cancelDocking') {
    state.assist = false;
    finish(record);
    camera(record, 0);
  } else {
    state.error = null;
    require('../roverManager').stopDockGuard(record.id);
    state.assist = type === 'dockAssist';
    camera(record, state.assist ? record.meta?.cameraServo?.minAngle ?? -45 : 0);
  }
  let speed;
  if (type === 'undock') {
    const maximum = Math.min(500, Number(record.meta?.maxWheelSpeed) || 500);
    const guarded = require('../overcurrentProtectionService').protectCommand(record.id, 'drive', { driveDirect: { left: -maximum, right: -maximum } }, { bypassed: require('../roleService').isAdmin(socket) });
    speed = Math.min(Math.abs(guarded.driveDirect.left), Math.abs(guarded.driveDirect.right));
    if (!speed && payload.backoff !== false) throw new Error('Undocking blocked by wheel protection');
  }
  const id = send(record, { type, ...(type === 'undock' ? { backoff: payload.backoff !== false, speed } : {}) });
  state.request = id;
  if (type === 'undock') {
    state.operation = { id, socket, timer: setTimeout(() => {
      send(record, { type: 'cancelDocking' });
      finish(record, { code: 'timeout', message: 'No undocking result received.' });
    }, 6000) };
  }
  publish(record);
  return id;
}
function handleResult(record, msg) {
  if (!record) return;
  const state = stateFor(record);
  if (state.request !== msg.id) return;
  if (msg.status !== 'ok') state.assist = false;
  require('../overcurrentProtectionService').protectCommand(record.id, 'drive', { driveDirect: { left: 0, right: 0 } });
  finish(record, msg.status === 'ok' ? null : { code: msg.status, message: msg.error || 'Undocking stopped.' });
}
function processState(record) {
  const state = stateFor(record);
  if (state.assist && (record.roverState?.docking === true || (record.roverState?.docked && record.roverState?.battery?.charging))) {
    state.assist = false; camera(record, 0);
  }
  publish(record);
}
function processTelemetry(record) {
  const state = stateFor(record);
  if (state.operation && (!state.operation.socket?.connected || !require('../roverManager').canDrive(record.id, state.operation.socket))) {
    send(record, { type: 'cancelDocking' });
    finish(record, { code: 'controlLost', message: 'Undocking stopped because control changed.' });
  }
  return snapshot(record);
}
function protectCommand(record, payload, { dockingOwned = false } = {}) {
  if (dockingOwned) return payload;
  const state = stateFor(record);
  if (payload.raw) {
    const raw = Buffer.from(payload.raw, 'base64');
    if ([137,145].includes(raw[0])) {
      if (raw.length !== 5) throw new Error('Invalid raw drive command');
      if (raw[0] === 145) return protectCommand(record, {type:'drive', driveDirect:{left:raw.readInt16BE(3),right:raw.readInt16BE(1)}});
      if (raw.readInt16BE(1) !== 0 && snapshot(record).movementLocked) throw new Error('Drive blocked while docked or undocking');
      if (state.assist) { const limited=Buffer.from(raw); limited.writeInt16BE(Math.max(-60,Math.min(60,raw.readInt16BE(1))),1); return {...payload,raw:limited.toString('base64')}; }
    }
  }
  if (payload.driveDirect) {
    const { left, right } = payload.driveDirect;
    if ((left || right) && snapshot(record).movementLocked) throw new Error('Drive blocked while docked or undocking');
    if (state.assist) {
      const scale = Math.min(1, 60 / Math.max(Math.abs(left), Math.abs(right), 1));
      return { ...payload, driveDirect: { left: Math.round(left*scale), right: Math.round(right*scale) } };
    }
  }
  if (payload.servo && state.assist) throw new Error('Camera locked during dock assist');
  return payload;
}
const ownershipTimer = setInterval(() => {
  for (const record of require('../roverManager').rovers.values()) processTelemetry(record);
}, 250);
ownershipTimer.unref?.();
function disconnect(record) { finish(record); stateFor(record).assist = false; }
module.exports = {
  intents, issueIntent, snapshot, processState, processTelemetry, protectCommand, disconnect, handleResult,
  shouldIgnoreDriveInput: (record, payload) => Boolean(stateFor(record).operation && (payload.driveDirect || (payload.raw && [137,145].includes(Buffer.from(payload.raw,'base64')[0])))),
  canAdjustReverse: record => Boolean(record && stateFor(record).operation),
};
