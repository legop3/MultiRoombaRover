// Idle Service
// Purpose: Triggers a modular idle action pipeline after a sustained no-driver period.
// Scope: Observes driver activity events and coordinates timer-based idle automation execution.
const logger = require('../../globals/logger').child('idleService');
const { getActiveDrivers, turnEvents } = require('../turnService');
const roverManager = require('../roverManager');
const { IDLE_TIMEOUT_MS } = require('./constants');
const { runtime } = require('./state');
const { runIdleActions } = require('./actions');

function getActiveDriverCount() {
  const active = getActiveDrivers();
  const turnCount = active && typeof active === 'object' ? Object.keys(active).length : 0;
  if (turnCount > 0) return turnCount;
  let liveCount = 0;
  roverManager.rovers.forEach((record) => {
    if (record?.drivers?.size > 0) liveCount += 1;
  });
  return liveCount;
}

function clearIdleTimer() {
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = null;
  }
  runtime.deadlineAt = null;
}

function scheduleIdleTimer() {
  if (runtime.timer) return;
  runtime.deadlineAt = Date.now() + IDLE_TIMEOUT_MS;
  runtime.timer = setTimeout(async () => {
    runtime.timer = null;
    runtime.deadlineAt = null;
    if (getActiveDriverCount() > 0) {
      return;
    }
    runtime.lastTriggeredAt = Date.now();
    const results = await runIdleActions();
    logger.info('Idle automation executed', {
      idleMs: IDLE_TIMEOUT_MS,
      resultCount: results.length,
      failures: results.filter((entry) => !entry.ok).length,
    });
    refreshIdleState();
  }, IDLE_TIMEOUT_MS);
}

function refreshIdleState() {
  if (getActiveDriverCount() > 0) {
    clearIdleTimer();
    return;
  }
  scheduleIdleTimer();
}

turnEvents.on('activeDriver', refreshIdleState);
turnEvents.on('queue', refreshIdleState);

refreshIdleState();

module.exports = {
  refreshIdleState,
};
