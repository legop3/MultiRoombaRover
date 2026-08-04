// MediaMTX Child Supervisor
// Purpose: Writes the generated runtime configuration and owns the MediaMTX child process lifecycle.
// Scope: Starts exactly one child, forwards its logs, and lets systemd restart the coherent server/media pair.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const yaml = require('js-yaml');
const { buildMediaMtxConfig } = require('./config');

function createMediaMtxSupervisor(deps) {
  const {
    config,
    serverPort,
    logger,
    mediaMtxBin = process.env.MEDIAMTX_BIN || '/usr/local/bin/mediamtx',
    runtimeDir = process.env.MULTIROVER_RUNTIME_DIR || '/run/multirover',
    snapshotWriterPath = process.env.ROVER_SNAPSHOT_WRITER_BIN || '/usr/local/bin/rover-snapshot-writer.sh',
    spawnProcess = spawn,
  } = deps;

  let child = null;
  let stopping = false;
  let stoppedCallback = null;

  function forwardLines(stream, level) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      lines.filter(Boolean).forEach((line) => logger[level](line));
    });
    stream.on('end', () => {
      if (pending) logger[level](pending);
    });
  }

  function start() {
    if (child) return child;

    const runtimeConfig = buildMediaMtxConfig({ config, serverPort, snapshotWriterPath });
    const configPath = path.join(runtimeDir, 'mediamtx.yml');
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o750 });
    fs.writeFileSync(configPath, yaml.dump(runtimeConfig, { noRefs: true, lineWidth: 120 }), { mode: 0o640 });

    logger.info(`Starting MediaMTX with generated config ${configPath}`);
    child = spawnProcess(mediaMtxBin, [configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    forwardLines(child.stdout, 'info');
    forwardLines(child.stderr, 'warn');

    child.once('error', (err) => {
      logger.error('Unable to start MediaMTX', err);
      if (!stopping) {
        /*
          A spawn failure does not reliably emit the normal exit event on every platform.
          Fail the parent here as well so the server can never stay nominally online without
          its required media child and systemd gets the opportunity to repair the launch.
        */
        process.exit(1);
      }
    });
    child.once('exit', (code, signal) => {
      child = null;
      if (stopping) {
        stoppedCallback?.();
        stoppedCallback = null;
        return;
      }

      /*
        MediaMTX is required for every live media path. Exiting the parent is intentionally
        simpler and safer than maintaining a second retry policy inside Node: systemd already
        restarts multirover.service, producing one clean server/MediaMTX lifecycle.
      */
      logger.error(`MediaMTX exited unexpectedly (code=${code ?? 'none'} signal=${signal || 'none'})`);
      process.exit(1);
    });
    return child;
  }

  function stop(onStopped) {
    stopping = true;
    stoppedCallback = typeof onStopped === 'function' ? onStopped : null;
    if (!child) {
      stoppedCallback?.();
      stoppedCallback = null;
      return;
    }
    try {
      child.kill('SIGTERM');
    } catch (err) {
      logger.warn('Unable to stop MediaMTX cleanly', err);
    }
  }

  return { start, stop };
}

module.exports = { createMediaMtxSupervisor };
