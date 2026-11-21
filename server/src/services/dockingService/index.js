// Command forwarding and presentation only; docking decisions come from roverd.
const intents = new Set(['enterDocking', 'dockAssist', 'autoDock', 'cancelDocking', 'undock']);
function snapshot(record) {
  return record.roverState?.dockingStatus || { phase: 'unknown', movementLocked: true, cameraLocked: false, error: null };
}
function processState(record) {
  require('../../globals/io').to(record.room).emit('dockingState', { roverId: record.id, docking: snapshot(record) });
}
function issueIntent(record, type, payload) {
  if (type === 'enterDocking') type = 'dockAssist';
  return require('../commandService').issueCommand(record.id, { type, ...(type === 'undock' ? { backoff: payload.backoff !== false } : {}) });
}
function handleResult(record, msg) {
  if (record) require('../../globals/io').to(record.room).emit('commandAck', { roverId: record.id, id: msg.id, status: msg.status, error: msg.error });
}
module.exports = {
  intents, issueIntent, snapshot, processState, handleResult,
  processTelemetry: snapshot,
  disconnect: processState,
  isUndocking: record => record?.roverState?.dockingStatus?.phase === 'undocking',
};
