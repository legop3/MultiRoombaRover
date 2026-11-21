// The server owns authorization and pending commands; the rover owns docking behavior.
const states = new WeakMap();
const intents = new Set(['enterDocking', 'dockAssist', 'autoDock', 'cancelDocking', 'undock']);
function stateFor(record) {
  if (!states.has(record)) states.set(record, { operation: null, error: null });
  return states.get(record);
}
function snapshot(record) {
  const local = stateFor(record), state = record.roverState;
  return {
    phase: local.operation ? 'undocking' : state?.docked === true ? (state.battery?.charging ? 'charging' : 'docked') : state?.dockAssist === true ? 'assisting' : state?.docking ? 'seeking' : 'idle',
    movementLocked: Boolean(local.operation || local.error || state?.docked !== false || state?.drivingMode !== true),
    cameraLocked: state?.dockAssist === true, error: local.error,
  };
}
function publish(record) {
  require('../../globals/io').to(record.room).emit('dockingState', { roverId: record.id, docking: snapshot(record) });
}
function send(record, payload) { return require('../commandService').issueCommand(record.id, payload); }
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
  if (type === 'cancelDocking') finish(record);
  state.error = null;
  require('../roverManager').stopDockGuard(record.id);
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
  require('../overcurrentProtectionService').protectCommand(record.id, 'drive', { driveDirect: { left: 0, right: 0 } });
  finish(record, msg.status === 'ok' ? null : { code: msg.status, message: msg.error || 'Undocking stopped.' });
}
function processState(record) {
  const local = stateFor(record);
  const docked = record.roverState?.docked;
  if (!local.operation && docked === true && local.docked !== true) {
    // The rover stops locally; forget held intents here too so protection
    // cannot replay pre-contact drive or brush commands after undocking.
    const protection = require('../overcurrentProtectionService');
    protection.protectCommand(record.id, 'drive', { driveDirect: { left: 0, right: 0 } });
    protection.protectCommand(record.id, 'motors', { motorPwm: { main: 0, side: 0, vacuum: 0 } });
  }
  local.docked = docked;
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
const ownershipTimer = setInterval(() => {
  for (const record of require('../roverManager').rovers.values()) processTelemetry(record);
}, 250);
ownershipTimer.unref?.();
function disconnect(record) { finish(record); }
module.exports = {
  intents, issueIntent, snapshot, processState, processTelemetry, disconnect, handleResult,
  isUndocking: record => Boolean(record && stateFor(record).operation),
};
