// server Control Service
// Purpose: Lets a lockdown administrator restart the Node application without rebooting or controlling the host.
// Scope: Authorizes and announces one restart request; existing SIGTERM hooks own service and child-process cleanup.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('serverControlService');
const { getConfigurationDatabase } = require('../../configuration');
const { requireLockdownAdministrator, requireRecentPassword } = require('../adminConfigurationService');
const lifecycleClient = require('./lifecycleClient');
const { setAdminReason } = require('../adminReasonService');
const roverManager = require('../roverManager');
const assignmentService = require('../assignmentService');

const database = getConfigurationDatabase();
let restartPending = false;

function actorFor(socket) {
  return socket?.data?.user?.username || socket.id;
}

function notifyDriversOfRestart(actor) {
  // All requested restart paths share this persistent explanation. Updating
  // the reason does not change server mode or arrange to clear it at startup.
  const message = 'Server is restarting...';
  setAdminReason(message, { by: actor });
  for (const [roverId, rover] of roverManager.rovers) {
    // Releasing control mutates the set, so snapshot the current drivers and
    // send each the existing removal notice before their assignment changes.
    for (const socketId of [...rover.drivers]) {
      assignmentService.forceReleaseWithNotice(roverId, socketId, {
        title: message,
        message,
        reasonCode: 'application-restart',
        actor,
      });
    }
  }
}

function scheduleApplicationRestart() {
  if (restartPending) throw new Error('Application restart already pending.');
  restartPending = true;

  /*
    Socket acknowledgements are asynchronous network writes. This short delay
    lets the response and restarting notification leave before SIGTERM invokes
    the cleanup hooks already owned by the server's long-running services.
  */
  setTimeout(() => {
    try {
      process.kill(process.pid, 'SIGTERM');
    } catch (error) {
      // If signaling fails, this process is still usable and must allow the
      // administrator to try again instead of remaining permanently pending.
      restartPending = false;
      logger.error('Application restart signal failed', error.message);
    }
  }, 250);
}

function requestApplicationRestart({ actor, reason = 'administrator-requested' }) {
  if (restartPending) throw new Error('Application restart already pending.');
  database.recordAuditEvent(actor, 'application.restart-requested', { reason });
  notifyDriversOfRestart(actor);
  scheduleApplicationRestart();
  logger.warn('Application restart requested', { actor, reason });
  // Restore and ordinary admin restarts share this one browser contract, so
  // clients can explain the disconnect without knowing which control invoked it.
  io.emit('server:restarting', { reason });
}

io.on('connection', (socket) => {
  socket.on('server:lifecycleStatus', (_payload = {}, cb = () => {}) => {
    Promise.resolve()
      .then(() => requireLockdownAdministrator(socket))
      .then(() => lifecycleClient.getLifecycleStatus())
      .then((lifecycle) => cb({ success: true, lifecycle }))
      .catch((error) => cb({ error: error.message, code: error.code || null }));
  });

  socket.on('server:checkForUpdate', (_payload = {}, cb = () => {}) => {
    Promise.resolve()
      .then(() => requireRecentPassword(socket))
      .then(() => lifecycleClient.checkForUpdate())
      .then((lifecycle) => {
        database.recordAuditEvent(actorFor(socket), 'application.update-check-requested', {});
        cb({ success: true, lifecycle });
      })
      .catch((error) => cb({ error: error.message, code: error.code || null }));
  });

  socket.on('server:updateApplication', (_payload = {}, cb = () => {}) => {
    Promise.resolve()
      .then(() => requireRecentPassword(socket))
      .then(() => lifecycleClient.updateApplication())
      .then((lifecycle) => {
        // Wait for controller acceptance so rejected updates do not kick users.
        notifyDriversOfRestart(actorFor(socket));
        database.recordAuditEvent(actorFor(socket), 'application.update-requested', {});
        io.emit('server:restarting', { reason: 'application-update' });
        cb({ success: true, lifecycle });
      })
      .catch((error) => cb({ error: error.message, code: error.code || null }));
  });

  socket.on('server:restartApplication', (_payload = {}, cb = () => {}) => {
    Promise.resolve().then(async () => {
      requireRecentPassword(socket);
      if (restartPending) throw new Error('Application restart already pending.');
      const actor = actorFor(socket);
      try {
        const lifecycle = await lifecycleClient.restartApplication();
        restartPending = true;
        // Container restarts bypass the process-signal path, but need the same
        // persistent reason and removal notices once the controller accepts.
        notifyDriversOfRestart(actor);
        database.recordAuditEvent(actor, 'application.restart-requested', { reason: 'administrator-requested' });
        logger.warn('Application container restart requested', { actor });
        io.emit('server:restarting', { reason: 'administrator-requested' });
        cb({ success: true, lifecycle });
      } catch (error) {
        /*
          Legacy installations intentionally have no controller socket. Keep
          their existing process-signal restart during migration, but never
          bypass a real controller rejection such as an operation conflict.
        */
        if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
        requestApplicationRestart({ actor });
        cb({ success: true, legacy: true });
      }
    }).catch((error) => cb({ error: error.message, code: error.code || null }));
  });
});

module.exports = {
  isApplicationRestartPending: () => restartPending,
  requestApplicationRestart,
};
