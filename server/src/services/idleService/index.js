// Idle Service
// Purpose: Triggers a modular idle action pipeline after a sustained no-operator-online period.
// Scope: Observes user/admin socket presence and coordinates timer-based idle automation execution.
const logger = require('../../globals/logger').child('idleService');
const io = require('../../globals/io');
const { getRole, roleEvents } = require('../roleService');
const { IDLE_TIMEOUT_MS } = require('./constants');
const { runtime } = require('./state');
const { runIdleActions } = require('./actions');

function getActivitySnapshot() {
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

    /*
      Lockdown admins are counted with regular admins because both represent a
      person with operator-level access who may be supervising the room without
      actively driving a rover. Plain users also count even before they request
      control, which is the behavior this service now needs.
    */
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
      logger.info('Idle automation skipped; user or admin online', activity);
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
  const activity = getActivitySnapshot();
  logger.info('Idle state refresh', activity);
  if (activity.totalActive > 0) {
    clearIdleTimer();
    return;
  }
  scheduleIdleTimer();
}

io.on('connection', (socket) => {
  /*
    A user/admin can be online without ever touching rover controls, so socket
    presence has to be a first-class idle signal. The disconnect hook is just as
    important: it is what starts the idle timeout after the last non-spectator
    leaves, even if no driving event happens around that departure.
  */
  refreshIdleState();
  socket.on('disconnect', refreshIdleState);
});

roleEvents.on('change', refreshIdleState);

refreshIdleState();

module.exports = {
  refreshIdleState,
};
