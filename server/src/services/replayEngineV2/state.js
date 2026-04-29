// Replay Engine State
// Purpose: Holds mutable runtime state for workers, segment index, and scheduler lifecycle.
// Scope: Provides shared process-local state without embedding behavior logic.
const EventEmitter = require('events');

const events = new EventEmitter();
const workers = new Map();
const pendingWorkerStarts = new Set();
const segmentIndex = new Map();

const runtime = {
  cleanupTimer: null,
  activeSegmentRoot: null,
  tickInFlight: false,
};

module.exports = {
  events,
  workers,
  pendingWorkerStarts,
  segmentIndex,
  runtime,
};
