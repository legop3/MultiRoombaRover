// Home Assistant Runtime Engine Tests
// Purpose: Verifies the service-wide full-brightness rule for light commands.
// Scope: Exercises injected Home Assistant calls without opening a real connection or starting the server.

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRuntimeEngine } = require('./runtimeEngine');
const { entityConfig, entityState, runtime } = require('./state');

function createHarness() {
  const calls = [];
  const engine = createRuntimeEngine({
    enabled: true,
    haConfig: { whiteKelvin: 4000 },
    callHomeAssistantService: async (domain, service, serviceData) => {
      calls.push({ domain, service, serviceData });
    },
    // These tests only verify outbound service payloads. A no-op logger keeps
    // the harness faithful to the runtime dependency contract without adding
    // unrelated output to the test run.
    logger: {
      info() {},
      warn() {},
    },
  });

  return { calls, engine };
}

test('light interactions force full brightness without changing switches or off commands', async (t) => {
  const { calls, engine } = createHarness();

  /*
    runtimeEngine uses the shared entity registry populated from configuration
    in production. Seed the smallest representative registry here and restore
    the shared state afterward so this focused unit test cannot leak state into
    other Home Assistant tests added later.
  */
  entityConfig.clear();
  entityState.clear();
  entityConfig.set('light.room', { id: 'light.room', type: 'light', domain: 'light' });
  entityConfig.set('switch.lamp', { id: 'switch.lamp', type: 'switch', domain: 'switch' });
  runtime.connection = {};
  t.after(() => {
    entityConfig.clear();
    entityState.clear();
    runtime.connection = null;
  });

  await engine.setEntityState('light.room', 'on');
  await engine.setLightColor('light.room', [12, 34, 56]);
  await engine.setLightWhite('light.room', 4500);
  await engine.setEntityState('light.room', 'off');
  await engine.setEntityState('switch.lamp', 'on');

  assert.deepEqual(calls, [
    {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.room', brightness_pct: 100 },
    },
    {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.room', rgb_color: [12, 34, 56], brightness_pct: 100 },
    },
    {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.room', color_temp_kelvin: 4500, brightness_pct: 100 },
    },
    {
      domain: 'light',
      service: 'turn_off',
      serviceData: { entity_id: 'light.room' },
    },
    {
      domain: 'switch',
      service: 'turn_on',
      serviceData: { entity_id: 'switch.lamp' },
    },
  ]);
});
