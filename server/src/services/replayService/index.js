// replay Service
// Purpose: Defines the replay Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const EventEmitter = require('events');

const COOLDOWN_MS = 10 * 1000;

const events = new EventEmitter();
let lastTriggeredAt = null;
let lastTriggeredBy = null;

function getRemainingMs(now = Date.now()) {
  if (!lastTriggeredAt) return 0;
  const elapsed = now - lastTriggeredAt;
  return Math.max(0, COOLDOWN_MS - elapsed);
}

function getState() {
  const remainingMs = getRemainingMs();
  return {
    cooldownMs: COOLDOWN_MS,
    lastTriggeredAt,
    lastTriggeredBy,
    remainingMs,
    available: remainingMs === 0,
  };
}

function tryTrigger(by = null) {
  const remainingMs = getRemainingMs();
  if (remainingMs > 0) {
    return { ok: false, remainingMs, state: getState() };
  }
  lastTriggeredAt = Date.now();
  lastTriggeredBy = by || null;
  const state = getState();
  events.emit('update', { state, by: lastTriggeredBy });
  return { ok: true, state };
}

module.exports = {
  tryTriggerReplay: tryTrigger,
  getReplayState: getState,
  replayEvents: events,
};
