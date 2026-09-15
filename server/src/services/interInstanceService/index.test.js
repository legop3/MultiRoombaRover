// Inter-Instance Public Payload Tests
// Purpose: Verifies that configuration-backed public metadata can be assembled for peer servers.
// Scope: Runs the service in an isolated child process so its socket gateways, timers, and configuration singleton never touch another test's runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('builds the inter-instance payload when social links are enabled', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multirover-inter-instance-'));
  const serverRoot = path.resolve(__dirname, '../../..');

  try {
    /*
      Enabling Social links is essential to this regression: disabled links
      short-circuit before the configuration argument is read and therefore
      cannot expose a stale or missing configuration reference. The child
      process loads the real service graph and calls the same payload builder
      used by GET /api/inter-instance/info.
    */
    const script = `
      const configuration = require('./src/configuration');
      const database = configuration.getConfigurationDatabase();
      const current = database.getClientConfiguration();
      const next = structuredClone(current.config);
      next.socials.enabled = true;
      next.socials.links = [{
        id: 'community',
        label: 'Community',
        url: 'https://community.example.test',
        icon: 'FaUsers',
        color: '#38bdf8'
      }];
      database.updateConfiguration({
        value: next,
        expectedRevision: current.revision,
        actor: 'inter-instance-test'
      });
      configuration.applyCommittedConfiguration().then(() => {
        const { buildLocalInfo } = require('./src/services/interInstanceService');
        const payload = buildLocalInfo();
        // Production services may write startup logs to stdout. A unique
        // marker separates the assertion payload from that expected noise.
        process.stdout.write('\\n__INTER_INSTANCE_RESULT__' + JSON.stringify(payload.socials));
        database.close();
        // Requiring the production service intentionally registers persistent
        // Socket.IO gateways. The disposable child has completed its one real
        // payload assertion, so it must not wait for those server-owned handles.
        process.exit(0);
      }).catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: serverRoot,
      env: { ...process.env, SERVER_DATA_DIR: dataRoot },
      encoding: 'utf8',
    });

    const resultMarker = '__INTER_INSTANCE_RESULT__';
    const resultOffset = output.lastIndexOf(resultMarker);
    assert.notEqual(resultOffset, -1, 'child process did not emit its inter-instance result');
    assert.deepEqual(JSON.parse(output.slice(resultOffset + resultMarker.length)), [{
      id: 'community',
      label: 'Community',
      url: 'https://community.example.test',
      icon: 'FaUsers',
      color: '#38bdf8',
    }]);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
