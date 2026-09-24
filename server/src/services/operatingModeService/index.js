const EventEmitter = require('events');

const operatingModeEvents = new EventEmitter();
const transitions = new WeakMap();

function getOperatingMode(socket) {
  // Handshake intent reserves the mode before role-driven assignment runs.
  // It grants no camera permissions; entry still checks access and readiness.
  return socket?.data?.operatingMode
    || (socket?.handshake?.auth?.operatingMode === 'ptz' ? 'ptz' : 'rover');
}

async function transition(socket, operatingMode) {
  // Resolve services at the action boundary to avoid a dependency cycle with
  // assignment and camera policy, which both read operating mode.
  const assignment = require('../assignmentService');
  const roverManager = require('../roverManager');
  const ptz = require('../ptzCameraService');
  if (operatingMode === 'rover' && getOperatingMode(socket) === 'rover') {
    return { operatingMode, state: ptz.getPublicState(socket) };
  }
  if (operatingMode === 'ptz') {
    await ptz.prepareParticipation(socket);
    if (socket.disconnected) throw new Error('Session disconnected');
    ptz.checkParticipationAccess(socket);
    const leave = roverManager.canLeaveCurrentRover(socket);
    if (!leave.ok) throw new Error(leave.message);

    // Block new rover ownership before release events notify other services.
    socket.data.operatingMode = 'ptz';
    assignment.releaseForOperatingMode(socket);
    socket.data.ptzEntered = true;
  } else {
    ptz.releaseTurn(socket);
    socket.data.ptzEntered = false;
    socket.data.operatingMode = 'rover';
    assignment.resumeAssignment(socket);
  }
  operatingModeEvents.emit('change', { socket, operatingMode });
  return { operatingMode, state: ptz.getPublicState(socket) };
}

function enqueueTransition(socket, action) {
  // Camera initialization can yield. Serialize switches and turn release per
  // socket so a late entry cannot undo a subsequent exit or release request.
  const previous = transitions.get(socket) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => {
    if (socket.disconnected) throw new Error('Session disconnected');
    return action();
  });
  transitions.set(socket, next);
  return next;
}

function setOperatingMode(socket, operatingMode) {
  if (!['rover', 'ptz'].includes(operatingMode)) {
    return Promise.reject(new Error('Invalid operating mode'));
  }
  return enqueueTransition(socket, () => transition(socket, operatingMode));
}

function runPtzTurnAction(socket, action) {
  return enqueueTransition(socket, () => {
    const ptz = require('../ptzCameraService');
    if (action === 'release') return ptz.releaseTurn(socket);
    if (action !== 'request') throw new Error('Invalid PTZ turn action');
    if (getOperatingMode(socket) !== 'ptz' || !socket.data.ptzEntered) {
      throw new Error('Enter PTZ before requesting a turn');
    }
    return ptz.claimTurn(socket);
  });
}

module.exports = { getOperatingMode, setOperatingMode, runPtzTurnAction, operatingModeEvents };
