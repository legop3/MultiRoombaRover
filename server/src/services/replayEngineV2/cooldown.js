// Replay Cooldown State
// Purpose: Tracks replay trigger cooldown state and emits updates for consumers.
// Scope: Encapsulates replay cooldown timing and trigger bookkeeping.
const EventEmitter = require('events');

const COOLDOWN_MS = 10 * 1000;
const replayEvents = new EventEmitter();
let lastTriggeredAt = null;
let lastTriggeredBy = null;

function getRemainingMs(now = Date.now()) {
  if (!lastTriggeredAt) return 0;
  return Math.max(0, COOLDOWN_MS - (now - lastTriggeredAt));
}

function getReplayState() {
  const remainingMs = getRemainingMs();
  return {
    cooldownMs: COOLDOWN_MS,
    lastTriggeredAt,
    lastTriggeredBy,
    remainingMs,
    available: remainingMs === 0,
  };
}

function tryTriggerReplay(by = null) {
  const remainingMs = getRemainingMs();
  if (remainingMs > 0) {
    return { ok: false, remainingMs, state: getReplayState() };
  }
  lastTriggeredAt = Date.now();
  lastTriggeredBy = by || null;
  const state = getReplayState();
  replayEvents.emit('update', { state, by: lastTriggeredBy });
  return { ok: true, state };
}

module.exports = {
  tryTriggerReplay,
  getReplayState,
  replayEvents,
};
