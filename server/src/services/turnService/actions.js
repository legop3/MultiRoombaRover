// actions
// Purpose: Defines the actions module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
function stopRover(roverId) {
  try {
    const { issueCommand } = require('../commandService');
    issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
    issueCommand(roverId, { type: 'motors', motorPwm: { main: 0, side: 0, vacuum: 0 } });
  } catch (err) {
    // best effort; log elsewhere if needed
  }
}

function removeDriverCompletely(roverId, socketId) {
  try {
    const assignmentService = require('../assignmentService');
    assignmentService.forceRelease(roverId, socketId);
  } catch (err) {
    // best effort; log elsewhere if needed
  }
}

module.exports = {
  stopRover,
  removeDriverCompletely,
};
