// Green Mode Reward Tests
// Purpose: Pins the five-press metadata and persisted timed-effect lifecycle.
// Scope: Uses a small context double; greenModeService behavior is tested through its public contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const reward = require('./greenMode');

function createContext() {
  const calls = [];
  let changeListener = null;
  return {
    calls,
    logger: { warn: () => {} },
    setGreenMode: async (enabled, options) => {
      calls.push({ type: 'set', enabled, source: options?.source });
      return enabled;
    },
    saveEffect: (id, payload) => calls.push({ type: 'save', id, payload }),
    clearEffect: (id) => calls.push({ type: 'clear', id }),
    onGreenModeChange: (listener) => {
      changeListener = listener;
      return () => {
        changeListener = null;
      };
    },
    emitGreenModeChange: (enabled) => changeListener?.(enabled),
  };
}

test('green mode reward requires five presses and starts a persisted effect', async () => {
  const ctx = createContext();
  assert.equal(reward.goal, 5);

  await reward.run(ctx);

  assert.deepEqual(ctx.calls[0], { type: 'set', enabled: true, source: 'buttonbox:greenMode' });
  const saved = ctx.calls.find((call) => call.type === 'save');
  assert.equal(saved?.id, 'greenMode');
  assert.ok(saved?.payload?.endsAt > Date.now());

  // Simulate an access-mode shutdown so the test also clears the reward's
  // twenty-minute timer instead of leaving background work in the test process.
  ctx.emitGreenModeChange(false);
  assert.ok(ctx.calls.some((call) => call.type === 'clear' && call.id === 'greenMode'));
});

test('invalid recovery state is cleared instead of starting a new duration', async () => {
  const ctx = createContext();
  await reward.recover(ctx, {});

  assert.deepEqual(ctx.calls[0], {
    type: 'set',
    enabled: false,
    source: 'buttonbox:greenModeExpired',
  });
  assert.ok(ctx.calls.some((call) => call.type === 'clear' && call.id === 'greenMode'));
});
