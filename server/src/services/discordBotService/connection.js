// Owns connection replacement and recovery from failed initial logins.
function createConnectionManager({ createRuntime, logger }) {
  let desired = { enabled: false, token: '' };
  let revision = 0;
  let runtime = null;
  let queue = Promise.resolve();
  let retryTimer = null;
  let retryDelay = 5000;

  function enqueue(operation) {
    const pending = queue.then(operation);
    // Report failures without poisoning subsequent configuration changes.
    queue = pending.catch((err) => logger.error('Discord connection update failed', err.message));
    return pending;
  }

  async function stop() {
    const previous = runtime;
    runtime = null;
    if (!previous) return;
    previous.stop();
    // discord.js cannot cancel login while gateway discovery is pending.
    // Let that attempt settle before destroying it, otherwise it can open a
    // socket after destroy() has already run and leave an orphan connection.
    await previous.login;
    await previous.client.destroy();
  }

  function scheduleRetry(version) {
    if (version !== revision || !desired.enabled) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, 60000);
    logger.warn('Retrying Discord login', { delayMs: delay });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      enqueue(() => start(version));
    }, delay);
    retryTimer.unref?.();
  }

  async function start(version) {
    if (version !== revision || !desired.enabled) return;
    await stop();
    if (version !== revision || !desired.enabled) return;
    const current = createRuntime();
    runtime = current;
    const { client } = current;
    client.on('error', (err) => logger.error('Discord client error', err.message));
    client.on('shardError', (err, shardId) => {
      logger.warn('Discord connection error', { shardId, error: err.message });
    });
    client.on('shardDisconnect', (event, shardId) => {
      logger.warn('Discord disconnected', { shardId, code: event.code });
    });
    client.on('clientReady', () => { retryDelay = 5000; });

    // Login must not block configuration saves while the network is down.
    // Each attempt has its own client, so stale login completion/cleanup cannot
    // clear the credentials or stop the connection of its replacement.
    current.login = client.login(desired.token).catch((err) => {
      if (version !== revision || runtime !== current) return;
      logger.error('Discord login failed', err.message);
      enqueue(async () => {
        if (version !== revision || runtime !== current) return;
        await stop();
        // Credentials require an operator edit; retry network/service failures.
        if (err.code === 'TokenInvalid' || err.status === 401) return;
        scheduleRetry(version);
      });
    });
  }

  function configure({ enabled, token }) {
    const next = { enabled: Boolean(enabled), token };
    if (next.enabled === desired.enabled && next.token === desired.token) return queue;
    desired = next;
    const version = ++revision;
    clearTimeout(retryTimer);
    retryTimer = null;
    retryDelay = 5000;
    return enqueue(async () => {
      if (version !== revision) return;
      if (desired.enabled) await start(version);
      else await stop();
    });
  }

  return {
    configure,
    refresh() { runtime?.refresh(); },
  };
}

module.exports = { createConnectionManager };
