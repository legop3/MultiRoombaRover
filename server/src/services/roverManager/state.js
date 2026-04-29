// rover Manager state
// Purpose: Defines shared mutable in-memory state containers used by rover-manager workflows.
// Scope: Keeps runtime behavior unchanged while centralizing service state maps/sets and events.
const EventEmitter = require('events');

const rovers = new Map();
const socketToRovers = new Map();
const spectatorSockets = new Set();
const managerEvents = new EventEmitter();
const backoffTimers = new Map();
const dockGuardStates = new Map();
const privateButtonStates = new Map();
const privateNoUsersSince = new Map();
const privateSafetyTimers = new Map();
const privateSafetyStates = new Map();

module.exports = {
  rovers,
  socketToRovers,
  spectatorSockets,
  managerEvents,
  backoffTimers,
  dockGuardStates,
  privateButtonStates,
  privateNoUsersSince,
  privateSafetyTimers,
  privateSafetyStates,
};
