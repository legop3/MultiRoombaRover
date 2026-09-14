// server Control Service
// Purpose: Lets a lockdown administrator restart the Node application without rebooting or controlling the host.
// Scope: Authorizes and announces one restart request; existing SIGTERM hooks own service and child-process cleanup.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('serverControlService');
const { getConfigurationDatabase } = require('../../configuration');
const { requireRecentPassword } = require('../adminConfigurationService');

const database = getConfigurationDatabase();
let restartPending = false;

function actorFor(socket) {
  return socket?.data?.user?.username || socket.id;
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
  scheduleApplicationRestart();
  logger.warn('Application restart requested', { actor, reason });
  // Restore and ordinary admin restarts share this one browser contract, so
  // clients can explain the disconnect without knowing which control invoked it.
  io.emit('server:restarting', { reason });
}

io.on('connection', (socket) => {
  socket.on('server:restartApplication', (_payload = {}, cb = () => {}) => {
    try {
      requireRecentPassword(socket);
      const actor = actorFor(socket);
      requestApplicationRestart({ actor });
      cb({ success: true });
    } catch (error) {
      cb({ error: error.message, code: error.code || null });
    }
  });
});

module.exports = {
  isApplicationRestartPending: () => restartPending,
  requestApplicationRestart,
};
