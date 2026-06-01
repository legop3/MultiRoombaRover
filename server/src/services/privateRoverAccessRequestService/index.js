// Private Rover Access Request Service
// Purpose: Composes private-rover access request state, core workflows, and event hooks behind one API.
// Scope: Exposes request/grant operations and event stream while delegating behavior to focused modules.
const { DM_APPROVE_EMOJI, DM_DENY_EMOJI, requestEvents } = require('./state');
const {
  getStateForSocket,
  createRequest,
  hasClosedPrivateAccessForSocket,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
  applySocketGrantCache,
  refreshAllSocketGrantCaches,
  clearPendingForRover,
} = require('./core');
const { registerPrivateRoverAccessHooks } = require('./hooks');

registerPrivateRoverAccessHooks({
  applySocketGrantCache,
  refreshAllSocketGrantCaches,
  createRequest,
  clearPendingForRover,
});

module.exports = {
  DM_APPROVE_EMOJI,
  DM_DENY_EMOJI,
  requestEvents,
  getStateForSocket,
  createRequest,
  hasClosedPrivateAccessForSocket,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
};
