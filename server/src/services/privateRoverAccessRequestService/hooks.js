// Private Rover Access Hooks
// Purpose: Registers rover-manager and socket event handlers for private-access request updates.
// Scope: Binds framework events to core flow operations without owning business-rule decisions.
const io = require('../../globals/io');
const roverManager = require('../roverManager');
const { requestEvents, grants } = require('./state');

const GRANT_PRUNE_INTERVAL_MS = 60 * 1000;
let grantPruneTimer = null;

function registerPrivateRoverAccessHooks(deps) {
  const {
    applySocketGrantCache,
    refreshAllSocketGrantCaches,
    pruneExpiredGrantsAndRefresh,
    createRequest,
    clearPendingForRover,
  } = deps;

  if (!grantPruneTimer) {
    grantPruneTimer = setInterval(() => {
      pruneExpiredGrantsAndRefresh('grant_expired');
    }, GRANT_PRUNE_INTERVAL_MS);
    if (typeof grantPruneTimer.unref === 'function') {
      grantPruneTimer.unref();
    }
  }

  roverManager.managerEvents.on('private', ({ roverId, open } = {}) => {
    if (!roverId) return;
    if (open) {
      clearPendingForRover(roverId, 'opened');
      for (const [key, grant] of grants.entries()) {
        if (String(grant.roverId) === String(roverId)) {
          grants.delete(key);
        }
      }
      refreshAllSocketGrantCaches();
      roverManager.broadcastRoster();
    }
    requestEvents.emit('change', { reason: 'private_state', roverId: String(roverId), open: Boolean(open) });
  });

  roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
    if (!roverId) return;
    if (action === 'removed') {
      clearPendingForRover(roverId, 'rover_removed');
      for (const [key, grant] of grants.entries()) {
        if (String(grant.roverId) === String(roverId)) {
          grants.delete(key);
        }
      }
      refreshAllSocketGrantCaches();
      roverManager.broadcastRoster();
    }
    requestEvents.emit('change', { reason: 'rover', roverId: String(roverId), action: action || null });
  });

  io.on('connection', (socket) => {
    applySocketGrantCache(socket);

    function handleRequest({ roverId } = {}, cb = () => {}) {
      try {
        const { request, isNew } = createRequest(socket, roverId);
        cb({ success: true, requestId: request.id, status: request.status, existing: !isNew });
      } catch (err) {
        cb({ error: err.message });
      }
    }

    socket.on('privateRover:requestAccess', handleRequest);
    socket.on('session:privateRover:requestAccess', handleRequest);
    socket.on('session:identify', () => {
      applySocketGrantCache(socket);
      requestEvents.emit('change', { reason: 'identify', socketId: socket.id });
    });
  });
}

module.exports = {
  registerPrivateRoverAccessHooks,
};
