const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createConnectionManager } = require('./connection');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(t, attempts = []) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runtimes = [];
  const logs = [];
  const manager = createConnectionManager({
    logger: {
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    createRuntime() {
      const attempt = attempts[runtimes.length] || {};
      const client = new EventEmitter();
      const runtime = {
        client,
        stopped: false,
        destroyed: false,
        refresh() {},
        stop() { runtime.stopped = true; },
      };
      client.login = async (token) => {
        runtime.token = token;
        await attempt.login?.();
      };
      client.destroy = async () => {
        await attempt.destroy?.();
        runtime.destroyed = true;
      };
      runtimes.push(runtime);
      return runtime;
    },
  });
  return { manager, runtimes, logs };
}

test('retries a network failure at startup with a fresh client', async (t) => {
  const { manager, runtimes } = setup(t, [{ login: () => { throw new Error('getaddrinfo EAI_AGAIN'); } }]);
  await manager.configure({ enabled: true, token: 'token' });
  await flush();
  assert.equal(runtimes[0].stopped, true);
  assert.equal(runtimes[0].destroyed, true);
  t.mock.timers.tick(4999);
  await flush();
  assert.equal(runtimes.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(runtimes.length, 2);
  assert.equal(runtimes[1].token, 'token');
  assert.notEqual(runtimes[0].client, runtimes[1].client);
});

test('backs off repeated failures and cancels retries when disabled', async (t) => {
  const failed = { login: () => { throw new Error('Network unavailable'); } };
  const { manager, runtimes, logs } = setup(t, Array(8).fill(failed));
  await manager.configure({ enabled: true, token: 'token' });
  await flush();
  for (const delay of [5000, 10000, 20000, 40000, 60000]) {
    t.mock.timers.tick(delay);
    await flush();
  }
  assert.deepEqual(logs.filter(([message]) => message === 'Retrying Discord login').map(([, data]) => data.delayMs),
    [5000, 10000, 20000, 40000, 60000, 60000]);
  await manager.configure({ enabled: false, token: 'token' });
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(runtimes.length, 6);
});

test('waits for logout before logging in with a changed token', async (t) => {
  const logout = deferred();
  const { manager, runtimes } = setup(t, [{ destroy: () => logout.promise }]);
  await manager.configure({ enabled: true, token: 'old' });
  const change = manager.configure({ enabled: true, token: 'new' });
  await flush();
  assert.equal(runtimes[0].stopped, true);
  assert.equal(runtimes.length, 1);
  logout.resolve();
  await change;
  assert.equal(runtimes[0].destroyed, true);
  assert.equal(runtimes[1].token, 'new');
});

test('retires a pending login before replacement and ignores its stale failure', async (t) => {
  const login = deferred();
  const { manager, runtimes } = setup(t, [{ login: () => login.promise }]);
  await manager.configure({ enabled: true, token: 'old' });
  const change = manager.configure({ enabled: true, token: 'new' });
  await flush();
  assert.equal(runtimes[0].stopped, true);
  assert.equal(runtimes[0].destroyed, false);
  login.reject(new Error('Old connection failed'));
  await change;
  assert.equal(runtimes[0].destroyed, true);
  assert.equal(runtimes[1].token, 'new');
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(runtimes.length, 2);
});

test('re-enabling creates a fresh client; unrelated config edits do not reconnect', async (t) => {
  const { manager, runtimes } = setup(t);
  await manager.configure({ enabled: true, token: 'token' });
  await manager.configure({ enabled: true, token: 'token', channels: { general: 'new-channel' } });
  assert.equal(runtimes.length, 1);
  await manager.configure({ enabled: false, token: 'token' });
  assert.equal(runtimes[0].destroyed, true);
  await manager.configure({ enabled: true, token: 'token' });
  assert.equal(runtimes.length, 2);
});

test('invalid credentials wait for a token edit instead of retrying', async (t) => {
  const { manager, runtimes } = setup(t, [{ login: () => {
    throw Object.assign(new Error('Invalid token'), { code: 'TokenInvalid' });
  } }]);
  await manager.configure({ enabled: true, token: 'bad' });
  await flush();
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(runtimes.length, 1);
  await manager.configure({ enabled: true, token: 'fixed' });
  assert.equal(runtimes[1].token, 'fixed');
});

test('client and gateway errors are logged without throwing', async (t) => {
  const { manager, runtimes, logs } = setup(t);
  await manager.configure({ enabled: true, token: 'token' });
  runtimes[0].client.emit('error', new Error('Client failure'));
  runtimes[0].client.emit('shardError', new Error('Gateway failure'), 0);
  runtimes[0].client.emit('shardDisconnect', { code: 1006 }, 0);
  assert.deepEqual(logs.map(([message]) => message), [
    'Discord client error', 'Discord connection error', 'Discord disconnected',
  ]);
});
