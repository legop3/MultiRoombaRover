// session Service state
// Purpose: Stores session sync throttling state and timer references used across event handlers.
// Scope: Keeps runtime behavior unchanged while centralizing mutable session-sync state in one module.
let lastActivitySync = 0;
let pendingActivitySync = null;
let lastNightVisionSync = 0;
let pendingNightVisionSync = null;

function getState() {
  return {
    lastActivitySync,
    pendingActivitySync,
    lastNightVisionSync,
    pendingNightVisionSync,
  };
}

function setState(patch = {}) {
  if (Object.prototype.hasOwnProperty.call(patch, 'lastActivitySync')) {
    lastActivitySync = patch.lastActivitySync;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'pendingActivitySync')) {
    pendingActivitySync = patch.pendingActivitySync;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastNightVisionSync')) {
    lastNightVisionSync = patch.lastNightVisionSync;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'pendingNightVisionSync')) {
    pendingNightVisionSync = patch.pendingNightVisionSync;
  }
}

module.exports = {
  getState,
  setState,
};
