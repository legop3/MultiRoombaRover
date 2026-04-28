// session Service filters
// Purpose: Defines visibility-filter helpers for per-socket session payload shaping.
// Scope: Keeps runtime behavior unchanged while isolating rover/queue filtering concerns from orchestration.
const roverManager = require('../roverManager');

function filterVisibleRoverId(socket, roverId) {
  if (!roverId) return null;
  return roverManager.canSeeRover(roverId, socket) ? roverId : null;
}

function filterActiveDriversForSocket(activeDrivers = {}, socket) {
  const next = {};
  Object.entries(activeDrivers || {}).forEach(([roverId, socketId]) => {
    if (!roverManager.canSeeRover(roverId, socket)) return;
    next[roverId] = socketId;
  });
  return next;
}

function filterTurnQueuesForSocket(turnQueues = {}, socket) {
  const next = {};
  Object.entries(turnQueues || {}).forEach(([roverId, info]) => {
    if (!roverManager.canSeeRover(roverId, socket)) return;
    next[roverId] = info;
  });
  return next;
}

module.exports = {
  filterVisibleRoverId,
  filterActiveDriversForSocket,
  filterTurnQueuesForSocket,
};
