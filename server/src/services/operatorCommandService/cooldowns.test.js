// Operator Command Cooldown Tests
// Purpose: Verifies the per-actor rate limit opens and closes on the boundaries callers rely on.
// Scope: Pure; the gate takes an injected clock so no test needs to sleep.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCooldownGate, describeWait } = require('./cooldowns');

test('first use passes and an immediate repeat is refused', () => {
  const gate = createCooldownGate();
  assert.equal(gate.consume('bonk:alice', 1000, 0), 0);
  assert.equal(gate.consume('bonk:alice', 1000, 0), 1000);
  assert.equal(gate.consume('bonk:alice', 1000, 400), 600);
});

test('the window reopens exactly when it expires', () => {
  const gate = createCooldownGate();
  gate.consume('honk:alice', 1000, 0);
  assert.equal(gate.consume('honk:alice', 1000, 999), 1);
  assert.equal(gate.consume('honk:alice', 1000, 1000), 0);
});

test('a refused call does not extend the existing window', () => {
  const gate = createCooldownGate();
  gate.consume('honk:alice', 1000, 0);
  // Hammering the gate at t=500 must not push the reopen time out to t=1500.
  gate.consume('honk:alice', 1000, 500);
  gate.consume('honk:alice', 1000, 900);
  assert.equal(gate.consume('honk:alice', 1000, 1000), 0);
});

test('cooldowns are scoped per key so different actors and commands do not collide', () => {
  const gate = createCooldownGate();
  assert.equal(gate.consume('bonk:alice', 1000, 0), 0);
  assert.equal(gate.consume('bonk:bob', 1000, 0), 0);
  assert.equal(gate.consume('hug:alice', 1000, 0), 0);
  assert.equal(gate.consume('bonk:alice', 1000, 0), 1000);
});

test('a missing key or non-positive window never gates', () => {
  const gate = createCooldownGate();
  assert.equal(gate.consume('', 1000, 0), 0);
  assert.equal(gate.consume('bonk:alice', 0, 0), 0);
  assert.equal(gate.consume('bonk:alice', -5, 0), 0);
  // None of the above should have armed anything.
  assert.equal(gate.remaining('bonk:alice', 0), 0);
});

test('describeWait rounds up and switches to minutes', () => {
  assert.equal(describeWait(1), '1s');
  assert.equal(describeWait(4200), '5s');
  assert.equal(describeWait(60 * 1000), '1m');
  assert.equal(describeWait(95 * 1000), '1m 35s');
});
