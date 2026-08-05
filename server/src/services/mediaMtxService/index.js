// MediaMTX Service
// Purpose: Composes server configuration, runtime paths, and child-process supervision.
// Scope: Starts MediaMTX only after the HTTP auth endpoint is listening and stops it with the server.
const { loadConfig } = require('../../helpers/configLoader');
const globalConfig = require('../../globals/config');
const logger = require('../../globals/logger').child('mediamtx');
const { createMediaMtxSupervisor } = require('./supervisor');

const supervisor = createMediaMtxSupervisor({
  config: loadConfig(),
  serverPort: globalConfig.port,
  logger,
});

function startMediaMtx() {
  return supervisor.start();
}

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
