// Separate activity ownership over the shared HA transport: no room-light
// catalog, policy, or automation is consulted by this service.
const EventEmitter = require('events');
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const ha = require('../homeAssistantService');
const io = require('../../globals/io');
const { buildEntity } = require('./entityHelpers');
const { createLocks, resolveItem } = require('./locks');
const { createActions } = require('./actions');
const { getRole } = require('../roleService');
const { getMode } = require('../modeManager');
const logger = require('../../globals/logger').child('homeAssistantActivitiesService');

const events = new EventEmitter();
let config = loadConfig().homeAssistantActivities;
const locks = createLocks();
// A replacement connection must deliver its own snapshot before accepting
// writes; cached metadata may belong to the previously configured HA server.
let snapshotReady = false;
const actions = createActions({ getConfig: () => config, ha: {
  get enabled() { return ha.enabled; },
  isConnected: () => snapshotReady && ha.isConnected(),
  getRawEntitySnapshot: ha.getRawEntitySnapshot,
  callHomeAssistantService: ha.callHomeAssistantService,
}, locks });

function getState() {
  return {
    enabled: config.enabled,
    connected: ha.enabled && snapshotReady && ha.isConnected(),
    items: config.enabled ? config.items.map((item) => buildEntity(item, ha.getRawEntitySnapshot(item.id), locks.isLocked(item.id))) : [],
  };
}

let lastState;
function emitUpdate() {
  const state = getState();
  const serialized = JSON.stringify(state);
  // HA snapshots include every entity in the installation. Only changes to
  // this public allowlist should cause additional session broadcasts.
  if (serialized === lastState) return;
  lastState = serialized;
  events.emit('update', state);
}

function setLocked(query, locked) {
  const item = resolveItem(getState().items, query);
  locks.setLocked(item.id, locked);
  emitUpdate();
  return item;
}

ha.homeAssistantEvents.on('snapshot', () => {
  snapshotReady = true;
  emitUpdate();
});
ha.homeAssistantEvents.on('status', () => {
  snapshotReady = false;
  emitUpdate();
});
registerConfigurationHandler('homeAssistantActivities', (next) => {
  config = next;
  emitUpdate();
});
// Resolve access on the server for every command; clients only supply item/value.
io.on('connection', (socket) => {
  socket.on('homeAssistantActivities:act', async (payload) => {
    try {
      await actions.act(payload?.id, payload?.value, { role: getRole(socket), mode: getMode() });
    } catch (error) {
      // No acknowledgement state is sent to the browser: actual entity
      // changes arrive through the shared snapshot stream. Keep failures in
      // server logs without creating a second UI state protocol.
      logger.warn('Activity command failed', { id: payload?.id, error: error.message });
    }
  });
});

module.exports = { ...actions, getState, setLocked, activityEvents: events };
