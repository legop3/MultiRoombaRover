// Idle Service
// Purpose: Triggers a modular idle action pipeline after a sustained no-operator-online period.
// Scope: Observes user/admin socket presence and coordinates timer-based idle automation execution.
const logger = require('../../globals/logger').child('idleService');
const io = require('../../globals/io');
const { getRole, roleEvents } = require('../roleService');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { isDeterred, verificationEvents } = require('../verificationService');
const { IDLE_TIMEOUT_MS } = require('./constants');
const { runtime } = require('./state');
const { runIdleActions } = require('./actions');
const activityControls = require('../homeAssistantActivitiesService');

function getActivitySnapshot() {
  const mode = getMode();
  let onlineUsers = 0;
  let onlineAdmins = 0;
  let onlineSpectators = 0;
  let onlineIgnored = 0;

  io.sockets.sockets.forEach((socket) => {
    const role = getRole(socket);

    /*
      Idle automation is about whether a real operator is present, not whether
      a browser tab is merely watching. Spectators can leave the room lights,
      PTZ emitters, and rovers in their automated idle state because they are
      intentionally read-only and cannot be the person still using the setup.
    */
    if (role === 'spectator') {
      onlineSpectators += 1;
      return;
    }


    if (
      isDeterred(socket)
      || (mode === MODES.ADMIN && role !== 'admin' && role !== 'lockdown')
      || (mode === MODES.LOCKDOWN && role !== 'lockdown')
    ) {
      onlineIgnored += 1;
      return;
    }

    if (role === 'admin' || role === 'lockdown') {
      onlineAdmins += 1;
      return;
    }

    if (role === 'user') {
      onlineUsers += 1;
      return;
    }

    /*
      Unknown future roles should not accidentally keep automation disabled.
      If a new role should count as an operator, it should be added explicitly
      above so this policy remains easy to audit.
    */
    onlineIgnored += 1;
  });

  const totalActive = onlineUsers + onlineAdmins;
  return {
    onlineUsers,
    onlineAdmins,
    onlineSpectators,
    onlineIgnored,
    totalActive,
  };
}

function clearIdleTimer() {
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = null;
    logger.info('Idle timer cleared');
  }
  runtime.deadlineAt = null;
}

function scheduleIdleTimer() {
  if (runtime.timer) return;
  if (runtime.idleActionsCompleted) {
    logger.info('Idle timer not scheduled; idle actions already completed for this no-operator window', {
      lastTriggeredAt: runtime.lastTriggeredAt,
    });
    return;
  }
  runtime.deadlineAt = Date.now() + IDLE_TIMEOUT_MS;
  logger.info('Idle timer scheduled', {
    timeoutMs: IDLE_TIMEOUT_MS,
    deadlineAt: runtime.deadlineAt,
  });
  runtime.timer = setTimeout(async () => {
    runtime.timer = null;
    runtime.deadlineAt = null;
    const activity = getActivitySnapshot();
    if (activity.totalActive > 0) {
      logger.info('Idle automation skipped; eligible operator online', activity);
      return;
    }
    runtime.lastTriggeredAt = Date.now();
    /*
      Mark this idle window as handled before running the action pipeline. The
      pipeline can take time and can call into services that emit their own
      state changes; setting the guard first prevents any nested refresh from
      scheduling a second timer for the same continuous no-operator period.
    */
    runtime.idleActionsCompleted = true;
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
  const activity = getActivitySnapshot();
  logger.info('Idle state refresh', activity);
  activityControls.setOperatorsOnline(activity.totalActive > 0);
  if (activity.totalActive > 0) {
    clearIdleTimer();
    if (runtime.idleActionsCompleted) {
      logger.info('Idle action one-shot reset; operator is online again', activity);
    }
    runtime.idleActionsCompleted = false;
    return;
  }
  scheduleIdleTimer();
}

io.on('connection', (socket) => {
  refreshIdleState();
  socket.on('disconnect', refreshIdleState);
});

roleEvents.on('change', refreshIdleState);
modeEvents.on('change', refreshIdleState);
verificationEvents.on('change', refreshIdleState);

refreshIdleState();

module.exports = {
  refreshIdleState,
};
