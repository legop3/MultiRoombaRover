// MediaMTX Service
// Purpose: Composes server configuration, runtime paths, and child-process supervision.
// Scope: Starts MediaMTX only after the HTTP auth endpoint is listening and stops it with the server.
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const globalConfig = require('../../globals/config');
const logger = require('../../globals/logger').child('mediamtx');
const { createMediaMtxSupervisor } = require('./supervisor');

let supervisor = createSupervisor();
let started = false;

function createSupervisor() {
  return createMediaMtxSupervisor({
    config: loadConfig(),
    serverPort: globalConfig.port,
    logger,
  });
}

function startMediaMtx() {
  started = true;
  return supervisor.start();
}

function stopSupervisor() {
  return new Promise((resolve) => supervisor.stop(resolve));
}

async function reloadMediaMtx() {
  // MediaMTX consumes a generated document rather than the Node configuration
  // object directly. Replace its child process when either explicit media
  // hosts or the canonical public hostname changes.
  await stopSupervisor();
  supervisor = createSupervisor();
  if (started) supervisor.start();
}

registerConfigurationHandler('media', reloadMediaMtx);
registerConfigurationHandler('publicUrl', reloadMediaMtx);

/*
  Other services already use process signal hooks for their own workers. This hook performs
  only synchronous signal delivery; systemd's default control-group cleanup remains the final
  guarantee if the parent is killed before the child finishes exiting.
*/
process.once('exit', () => supervisor.stop());

function stopForSignal(signal) {
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  supervisor.stop(finish);
  /*
    A wedged child must not make systemd wait indefinitely. This timer is deliberately unref'd
    so it never keeps an otherwise-finished process alive; it is only a bound on graceful exit.
  */
  const forceExitTimer = setTimeout(finish, 5000);
  forceExitTimer.unref?.();
}

process.once('SIGINT', () => stopForSignal('SIGINT'));
process.once('SIGTERM', () => stopForSignal('SIGTERM'));

module.exports = { startMediaMtx };
