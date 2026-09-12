// Rover Roster Lifecycle Tests
// Purpose: Verifies that boot-discovered accessory metadata reaches the public rover roster unchanged.
// Scope: Covers roster projection only; roverd remains responsible for validating and reducing device descriptions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRosterLifecycle } = require('./rosterLifecycle');

function createRosterManager(meta) {
  const rovers = new Map([[
    meta.name,
    {
      id: meta.name,
      meta,
      batteryState: null,
      headlightState: null,
      laserState: null,
      locked: false,
      lockReason: null,
      lastSeen: 123,
    },
  ]]);

  return createRosterLifecycle({
    rovers,
    isPrivateRecord: () => false,
    isPrivateOpen: () => true,
    getPrivateSafety: () => ({}),
  });
}

test('getRoster preserves peripheral and control registration order', () => {
  const peripherals = [
    {
      id: 'firmata-0',
      name: 'Camera arm',
      controls: [
        { id: 'position', type: 'slider', name: 'Position', min: 0, max: 180 },
        { id: 'action', type: 'button', name: 'Action', mode: 'momentary' },
      ],
    },
    {
      id: 'firmata-1',
      name: 'Lighting',
      controls: [
        { id: 'brightness', type: 'number', name: 'Brightness', min: 0, max: 255 },
      ],
    },
  ];
  const manager = createRosterManager({ name: 'rover-one', peripherals });

  const [entry] = manager.getRoster();

  // Deep equality verifies both the public field set and array order. The
  // server must not alphabetize controls because their firmware order is a UI
  // contract rather than incidental transport ordering.
  assert.deepEqual(entry.peripherals, peripherals);
});

test('getRoster supplies an empty peripheral inventory when none was advertised', () => {
  const manager = createRosterManager({ name: 'rover-one' });

  const [entry] = manager.getRoster();

  assert.deepEqual(entry.peripherals, []);
});
