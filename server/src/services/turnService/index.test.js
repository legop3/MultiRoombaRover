// Turn Service Tests
// Purpose: Protects timed-turn state from unrelated queue membership changes.
// Scope: Exercises public turn operations and inspects only their published queue model; no HTTP server is started.

const assert = require('node:assert/strict');
const test = require('node:test');
const { MODES, setMode } = require('../modeManager');
const turnService = require('./index');

function enterTurnsMode() {
  /*
    Mode authorization is irrelevant to this state-machine test. The forced
    transition uses the same production mode event, ensuring existing queues
    are reconciled exactly as they would be after an administrator mode change.
  */
  setMode(MODES.TURNS, null, { force: true });
}

function resetRover(roverId) {
  turnService.cleanupRover(roverId);
}

test('joining an active rotation preserves the current turn and completed activity grace', () => {
  const roverId = 'turn-test-join';
  enterTurnsMode();
  turnService.driverAdded(roverId, 'driver-a');
  turnService.driverAdded(roverId, 'driver-b');

  const started = turnService.getTurnQueues()[roverId];
  assert.ok(started.deadline);
  assert.ok(started.idleDeadline);

  turnService.recordActivity(roverId, 'driver-a');
  const active = turnService.getTurnQueues()[roverId];
  assert.equal(active.idleDeadline, null);

  turnService.driverAdded(roverId, 'driver-c');
  const joined = turnService.getTurnQueues()[roverId];
  assert.equal(joined.current, 'driver-a');
  assert.equal(joined.deadline, active.deadline);
  assert.equal(joined.idleDeadline, null);

  resetRover(roverId);
});

test('a waiting driver leaving preserves both active deadlines', () => {
  const roverId = 'turn-test-waiting-leave';
  enterTurnsMode();
  turnService.driverAdded(roverId, 'driver-a');
  turnService.driverAdded(roverId, 'driver-b');
  turnService.driverAdded(roverId, 'driver-c');
  const before = turnService.getTurnQueues()[roverId];

  turnService.driverRemoved(roverId, 'driver-c');
  const after = turnService.getTurnQueues()[roverId];
  assert.equal(after.current, 'driver-a');
  assert.equal(after.deadline, before.deadline);
  assert.equal(after.idleDeadline, before.idleDeadline);

  resetRover(roverId);
});

test('dropping to one driver clears turn and idle deadlines immediately', () => {
  const roverId = 'turn-test-single-driver';
  enterTurnsMode();
  turnService.driverAdded(roverId, 'driver-a');
  turnService.driverAdded(roverId, 'driver-b');
  assert.ok(turnService.getTurnQueues()[roverId].deadline);

  turnService.driverRemoved(roverId, 'driver-b');
  const single = turnService.getTurnQueues()[roverId];
  assert.equal(single.current, 'driver-a');
  assert.equal(single.deadline, null);
  assert.equal(single.idleDeadline, null);

  resetRover(roverId);
});

test('turn deadlines are absent outside turns mode during queue grants', () => {
  const roverId = 'turn-test-admin-mode';
  setMode(MODES.ADMIN, null, { force: true });
  turnService.driverAdded(roverId, 'driver-a');
  turnService.driverAdded(roverId, 'driver-b', { force: true });

  const queue = turnService.getTurnQueues()[roverId];
  /*
    In non-turn modes syncState keeps the first regular queued driver current.
    Explicit administrator takeover uses the separate pauseQueue path; this
    assertion is concerned only with ensuring neither grant creates timers.
  */
  assert.equal(queue.current, 'driver-a');
  assert.equal(queue.deadline, null);
  assert.equal(queue.idleDeadline, null);

  resetRover(roverId);
});
