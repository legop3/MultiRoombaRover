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
  if (state.operation) return send(record, { type, ...(type === 'undock' ? { backoff: payload.backoff !== false } : {}) });
  state.error = null;
  require('../roverManager').stopDockGuard(record.id);
  const id = send(record, { type, ...(type === 'undock' ? { backoff: payload.backoff !== false } : {}) });
  state.request = id;
  if (type === 'undock') {
    state.operation = { id, socket, timer: setTimeout(() => {
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
function processTelemetry(record) { return snapshot(record); }
function disconnect(record) { finish(record); }
module.exports = {
  intents, issueIntent, snapshot, processState, processTelemetry, disconnect, handleResult,
  isUndocking: record => Boolean(record && stateFor(record).operation),
};
