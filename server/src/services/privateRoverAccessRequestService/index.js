// Private Rover Access Request Service
// Purpose: Composes private-rover access request state, core workflows, and event hooks behind one API.
// Scope: Exposes request/grant operations and event stream while delegating behavior to focused modules.
const { requestEvents } = require('./state');
const {
  getStateForSocket,
  createRequest,
  hasClosedPrivateAccessForSocket,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
  applySocketGrantCache,
  clearPendingForRover,
} = require('./core');
const { registerPrivateRoverAccessHooks } = require('./hooks');

registerPrivateRoverAccessHooks({
  applySocketGrantCache,
  createRequest,
  clearPendingForRover,
});

module.exports = {
  requestEvents,
  getStateForSocket,
  createRequest,
  hasClosedPrivateAccessForSocket,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
};
