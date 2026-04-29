// Private Rover Access State
// Purpose: Owns in-memory request, DM-link, cooldown, and grant maps for private-rover access flows.
// Scope: Exports mutable state containers and constants shared across service modules.
const EventEmitter = require('events');

const REQUEST_COOLDOWN_MS = 15 * 1000;
const DM_APPROVE_EMOJI = '✅';
const DM_DENY_EMOJI = '❌';

const requestEvents = new EventEmitter();
const pendingRequests = new Map();
const pendingByRequesterRover = new Map();
const lastRequestAtByRequester = new Map();
const dmMessages = new Map();
const grants = new Map();

module.exports = {
  REQUEST_COOLDOWN_MS,
  DM_APPROVE_EMOJI,
  DM_DENY_EMOJI,
  requestEvents,
  pendingRequests,
  pendingByRequesterRover,
  lastRequestAtByRequester,
  dmMessages,
  grants,
};
