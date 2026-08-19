// Rover assignment ranking tests
// Purpose: Locks the operator-defined rover priority order against accidental comparator regressions.
// Scope: Tests pure ranking only; assignment side effects and access policy remain owned by their existing services.
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareRoversForAssignment } = require('./roverRanking');

function rover({ id, docked, battery, drivers = 0 }) {
  /*
    Set size matches the production rover contract without introducing socket or
    rover-manager dependencies into these focused ordering tests.
  */
  return {
    id,
    docked,
    batteryState: battery == null ? null : { percentDisplay: battery },
    drivers: new Set(Array.from({ length: drivers }, (_, index) => `${id}-driver-${index}`)),
  };
}

function rankedIds(entries) {
  return entries.sort(compareRoversForAssignment).map((entry) => entry.id);
}

test('an empty rover outranks an occupied rover regardless of battery or docking state', () => {
  const result = rankedIds([
    rover({ id: 'occupied-high', docked: false, battery: 100, drivers: 1 }),
    rover({ id: 'docked-empty', docked: true, battery: 20 }),
  ]);

  assert.deepEqual(result, ['docked-empty', 'occupied-high']);
});

test('an undocked rover is preferred when both rovers are empty', () => {
  const result = rankedIds([
    rover({ id: 'docked-high', docked: true, battery: 100 }),
    rover({ id: 'undocked-low', docked: false, battery: 20 }),
  ]);

  assert.deepEqual(result, ['undocked-low', 'docked-high']);
});

test('lowest driver count ranks occupied rovers before battery percentage', () => {
  const result = rankedIds([
    rover({ id: 'busy-high', docked: false, battery: 100, drivers: 4 }),
    rover({ id: 'quieter-low', docked: false, battery: 20, drivers: 1 }),
  ]);

  assert.deepEqual(result, ['quieter-low', 'busy-high']);
});

test('battery percentage ranks rovers after availability and load are equal', () => {
  const result = rankedIds([
    rover({ id: 'low', docked: false, battery: 35, drivers: 1 }),
    rover({ id: 'high', docked: false, battery: 90, drivers: 1 }),
    rover({ id: 'middle', docked: false, battery: 60, drivers: 1 }),
  ]);

  assert.deepEqual(result, ['high', 'middle', 'low']);
});

test('known battery percentage outranks missing battery telemetry', () => {
  const result = rankedIds([
    rover({ id: 'unknown', docked: true, battery: null }),
    rover({ id: 'known', docked: true, battery: 5 }),
  ]);

  assert.deepEqual(result, ['known', 'unknown']);
});

test('exactly equivalent rovers remain tied for random selection by assignmentService', () => {
  const left = rover({ id: 'left', docked: false, battery: 80, drivers: 1 });
  const right = rover({ id: 'right', docked: false, battery: 80, drivers: 1 });

  assert.equal(compareRoversForAssignment(left, right), 0);
  assert.equal(compareRoversForAssignment(right, left), 0);
});
