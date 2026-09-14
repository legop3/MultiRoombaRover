// MediaMTX Supervisor Tests
// Purpose: Verifies that generated MediaMTX state and child hooks inherit the server's single data root.
// Scope: Uses a child-process double and a temporary directory; no listener or background process is started.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { PassThrough } = require('stream');
const { createMediaMtxSupervisor } = require('./supervisor');

test('passes the resolved data root to MediaMTX runOnReady hooks', () => {
  const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multirover-mediamtx-supervisor-'));
  const generatedConfigPath = path.join(temporaryDataDir, 'mediamtx.yml');
  const previousDataDir = process.env.SERVER_DATA_DIR;
  let invocation = null;

  process.env.SERVER_DATA_DIR = temporaryDataDir;

  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      child.emit('exit', 0, signal);
    };
    invocation = { command, args, options };
    return child;
  };

  const logger = {
    info() {},
    warn() {},
    error() {},
  };

  try {
    const supervisor = createMediaMtxSupervisor({
      config: { publicUrl: 'https://public.example.test', media: { additionalHosts: ['media.example.test'] } },
      serverPort: 8080,
      logger,
      mediaMtxBin: '/test/bin/mediamtx',
      snapshotWriterPath: '/test/bin/rover-snapshot-writer',
      configPath: generatedConfigPath,
      spawnProcess,
    });

    supervisor.start();

    assert.equal(invocation.command, '/test/bin/mediamtx');
    assert.deepEqual(invocation.args, [generatedConfigPath]);
    assert.equal(invocation.options.env.SERVER_DATA_DIR, temporaryDataDir);
    assert.equal(fs.existsSync(generatedConfigPath), true);

    supervisor.stop();
  } finally {
    /*
      Restore process-global state and delete only the test-owned directory so a
      failed assertion cannot alter later tests or leave generated YAML behind.
    */
    if (previousDataDir === undefined) delete process.env.SERVER_DATA_DIR;
    else process.env.SERVER_DATA_DIR = previousDataDir;
    fs.rmSync(temporaryDataDir, { recursive: true, force: true });
  }
});
