// Stub the websocket library before loading transport so metadata lifecycle
// tests cannot contact a server or leave reconnect processes running.
const test = require('node:test');
const assert = require('node:assert/strict');
const libraryPath = require.resolve('home-assistant-js-websocket');
const originalLibrary = require(libraryPath);
const owners = [];
const library = {
  Auth: class {},
  createConnection: async () => {
    const owner = {
      handlers: {}, unsubscribed: 0, catalog: { fan: {} },
      subscribeEvents: async (callback, event) => {
        owner.handlers[event] = callback;
        return () => { owner.unsubscribed += 1; };
      },
      addEventListener() {}, close() {},
    };
    owners.push(owner);
    return owner;
  },
  subscribeEntities: () => () => {},
  getServices: async (owner) => owner.fetch ? owner.fetch() : owner.catalog,
  callService: async () => {},
};
require.cache[libraryPath].exports = library;
const { createTransport } = require('./transport');
require.cache[libraryPath].exports = originalLibrary;
const settle = () => new Promise((resolve) => setImmediate(resolve));
function setup(t) {
  let updates = 0;
  const transport = createTransport({ enabled: true, haConfig: { url: 'http://example.invalid', token: 'test' },
    logger: { info() {}, warn() {} }, onSnapshot() {}, onStatus() {}, onServices() { updates += 1; } });
  t.after(() => transport.disconnect());
  return { transport, updates: () => updates };
}

test('service metadata loads, refreshes on registration/removal, and clears on disconnect', async (t) => {
  const { transport, updates } = setup(t);
  await transport.connect();
  await settle();
  const owner = owners.at(-1);
  assert.deepEqual(transport.getServiceDescriptions(), { fan: {} });
  owner.catalog = { fan: { new_action: { fields: { enabled: { selector: { boolean: {} } } } } } };
  owner.handlers.service_registered();
  await settle();
  assert.ok(transport.getServiceDescriptions().fan.new_action.fields.enabled.selector.boolean);
  owner.catalog = {};
  owner.handlers.service_removed();
  await settle();
  assert.deepEqual(transport.getServiceDescriptions(), {});
  assert.equal(updates(), 3);
  transport.disconnect();
  assert.equal(transport.getServiceDescriptions(), null);
  assert.equal(owner.unsubscribed, 2);
});

test('a late metadata response cannot repopulate a disconnected transport', async (t) => {
  const { transport, updates } = setup(t);
  await transport.connect();
  await settle();
  const owner = owners.at(-1);
  let finish;
  owner.fetch = () => new Promise((resolve) => { finish = resolve; });
  owner.handlers.service_registered();
  transport.disconnect();
  finish({ stale: {} });
  await settle();
  assert.equal(transport.getServiceDescriptions(), null);
  assert.equal(updates(), 1);
});

test('metadata failure leaves the shared room-control connection intact', async (t) => {
  const { transport } = setup(t);
  await transport.connect();
  await settle();
  const owner = owners.at(-1);
  owner.fetch = async () => { throw new Error('Metadata failed'); };
  owner.handlers.service_registered();
  await settle();
  assert.equal(transport.isConnected(), true);
});
