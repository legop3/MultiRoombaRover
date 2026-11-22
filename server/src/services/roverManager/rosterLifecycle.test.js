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
      roverState: null,
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

test('repeated unchanged roverState does not fan out roster or state events', () => {
  const { EventEmitter } = require('node:events');
  const managerEvents = new EventEmitter();
  const roverEvents = [];
  const socketEvents = [];
  const socket = { id: 'browser-1', emit: (type, data) => socketEvents.push(type) };
  const rovers = new Map([['cozmo', {
    id: 'cozmo', meta: { name: 'cozmo' }, roverState: null,
    batteryState: null, room: 'rover:cozmo', lastSeen: 0,
    drivers: new Set(), locked: false, needsHelp: false,
  }]]);
  const manager = createRosterLifecycle({
    rovers, managerEvents,
    io: {
      to: () => ({ emit: (type, data) => roverEvents.push(type) }),
      sockets: { sockets: new Map([['browser-1', socket]]) },
    },
    spectatorSockets: new Set(),
    isRoverVisibleToSocket: () => true,
    isPrivateRecord: () => false,
    isPrivateOpen: () => true,
    getPrivateSafety: () => ({}),
  });
  let updates = 0;
  managerEvents.on('rover', () => updates++);
  const state = {
    drivingMode: true, dockAssist: false, docking: false,
    docked: false, headlightOn: false, laserOn: null,
    battery: { percent: 56, charging: false, low: false,
               critical: false, needsCharge: false },
  };
  manager.setRoverState('cozmo', state);
  assert.equal(updates, 1);
  assert.deepEqual(roverEvents, ['roverState']);
  assert.deepEqual(socketEvents, ['rovers']);
  manager.setRoverState('cozmo', { ...state, battery: { ...state.battery } });
  assert.equal(updates, 1);
  assert.deepEqual(roverEvents, ['roverState']);
  assert.deepEqual(socketEvents, ['rovers']);
  manager.setRoverState('cozmo', { ...state, battery: { ...state.battery, percent: 57 } });
  assert.equal(updates, 2);
  assert.deepEqual(roverEvents, ['roverState', 'roverState']);
  assert.deepEqual(socketEvents, ['rovers', 'rovers']);
});
