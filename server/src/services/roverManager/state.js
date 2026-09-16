// rover Manager state
// Purpose: Defines shared mutable in-memory state containers used by rover-manager workflows.
// Scope: Keeps runtime behavior unchanged while centralizing service state maps/sets and events.
const EventEmitter = require('events');

const rovers = new Map();
const socketToRovers = new Map();
const spectatorSockets = new Set();
const managerEvents = new EventEmitter();
/*
  Service reload support requires optional consumers such as commentary to keep
  one stable rover listener even while disabled. Preserve a finite ceiling so
  accidental reload-time duplication still becomes visible.
*/
managerEvents.setMaxListeners(20);
const backoffTimers = new Map();
const dockGuardStates = new Map();
const dockProtectionStrikeStates = new Map();
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
  dockProtectionStrikeStates,
  privateButtonStates,
  privateNoUsersSince,
  privateSafetyTimers,
  privateSafetyStates,
};
