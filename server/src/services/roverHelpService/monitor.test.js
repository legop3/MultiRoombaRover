// Rover Help Monitor Tests
// Purpose: Locks down sustained-condition timing without real timers or hardware.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLIFF_HELP_MS,
  DOCK_GUARD_HELP_MS,
  WHEEL_DROP_HELP_MS,
  createRoverHelpMonitor,
} = require('./monitor');

function createHarness() {
  let timestamp = 1_000;
  const changes = [];
  const monitor = createRoverHelpMonitor({ now: () => timestamp, onChange: (change) => changes.push(change) });
  return {
    changes,
    monitor,
    advance(ms) {
      timestamp += ms;
    },
    now() {
      return timestamp;
    },
  };
}

test('requires a continuous wheel drop and clears help when it releases', () => {
  const harness = createHarness();
  const dropped = { bumpsAndWheelDrops: { wheelDropLeft: true } };
  harness.monitor.handleSensor('red', dropped);
  harness.advance(WHEEL_DROP_HELP_MS - 1);
  harness.monitor.handleSensor('red', dropped);
  assert.equal(harness.changes.length, 0);

  harness.advance(1);
  harness.monitor.handleSensor('red', dropped);
  assert.equal(harness.changes.at(-1).needsHelp, true);
  assert.equal(harness.changes.at(-1).addedReason, 'wheelDrop');

  harness.monitor.handleSensor('red', { bumpsAndWheelDrops: {} });
  assert.equal(harness.changes.at(-1).needsHelp, false);
});

test('a changed cliff combination restarts the ten minute timer', () => {
  const harness = createHarness();
  harness.monitor.handleSensor('blue', { cliffLeft: true });
  harness.advance(CLIFF_HELP_MS - 1);
  harness.monitor.handleSensor('blue', { cliffLeft: true, cliffFrontLeft: true });
  harness.advance(1);
  harness.monitor.handleSensor('blue', { cliffLeft: true, cliffFrontLeft: true });
  assert.equal(harness.changes.length, 0);

  harness.advance(CLIFF_HELP_MS - 1);
  harness.monitor.handleSensor('blue', { cliffLeft: true, cliffFrontLeft: true });
  assert.equal(harness.changes.at(-1).addedReason, 'cliff');
});

test('dock guard uses elapsed active time and clears when the guard stops', () => {
  const harness = createHarness();
  harness.monitor.handleDockGuard({ roverId: 'green', active: true, startedAt: harness.now() });
  harness.advance(DOCK_GUARD_HELP_MS);
  harness.monitor.handleSensor('green', {});
  assert.equal(harness.changes.at(-1).addedReason, 'docking');

  harness.monitor.handleDockGuard({ roverId: 'green', active: false });
  assert.equal(harness.changes.at(-1).needsHelp, false);
});

test('autonomous passive docking remains timed after wheel motion stops dock guard', () => {
  const harness = createHarness();
  harness.monitor.handleDockGuard({ roverId: 'yellow', active: true, startedAt: harness.now() });
  harness.monitor.handleSensor('yellow', { oiMode: { label: 'passive' }, chargingSources: {} });
  harness.monitor.handleDockGuard({ roverId: 'yellow', active: false });
  harness.advance(DOCK_GUARD_HELP_MS);
  harness.monitor.handleSensor('yellow', { oiMode: { label: 'passive' }, chargingSources: {} });
  assert.equal(harness.changes.at(-1).addedReason, 'docking');

  harness.monitor.handleSensor('yellow', {
    oiMode: { label: 'passive' },
    chargingSources: { homeBase: true },
  });
  assert.equal(harness.changes.at(-1).needsHelp, false);
});

test('clearing one reason retains help while another reason remains', () => {
  const harness = createHarness();
  const both = { bumpsAndWheelDrops: { wheelDropRight: true }, cliffRight: true };
  harness.monitor.handleSensor('orange', both);
  // Advance through the longer threshold so both independently sustained
  // conditions are active before exercising aggregate clearing behavior.
  harness.advance(WHEEL_DROP_HELP_MS);
  harness.monitor.handleSensor('orange', both);
  assert.deepEqual(harness.changes.at(-1).reasons.sort(), ['cliff', 'wheelDrop']);

  harness.monitor.handleSensor('orange', { cliffRight: true });
  assert.equal(harness.changes.at(-1).needsHelp, true);
  assert.deepEqual(harness.changes.at(-1).reasons, ['cliff']);
});
