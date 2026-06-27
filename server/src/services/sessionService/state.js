// session Service state
// Purpose: Stores session sync throttling state and timer references used across event handlers.
// Scope: Keeps runtime behavior unchanged while centralizing mutable session-sync state in one module.
let lastActivitySync = 0;
let pendingActivitySync = null;
let lastGPIOToggleSync = 0;
let pendingGPIOToggleSync = null;

function getState() {
  return {
    lastActivitySync,
    pendingActivitySync,
    lastGPIOToggleSync,
    pendingGPIOToggleSync,
  };
}

function setState(patch = {}) {
  if (Object.prototype.hasOwnProperty.call(patch, 'lastActivitySync')) {
    lastActivitySync = patch.lastActivitySync;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'pendingActivitySync')) {
    pendingActivitySync = patch.pendingActivitySync;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastGPIOToggleSync')) {
    lastGPIOToggleSync = patch.lastGPIOToggleSync;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'pendingGPIOToggleSync')) {
    pendingGPIOToggleSync = patch.pendingGPIOToggleSync;
  }
}

module.exports = {
  getState,
  setState,
};
