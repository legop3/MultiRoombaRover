// Rover Manager Lifecycle Tests
// Purpose: Verifies that physical rover removal clears every ownership index before a same-id reconnect.
// Scope: Covers driver membership cleanup only; assignment placement policy remains in assignmentService.
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { createRoverLifecycle } = require('./roverLifecycle');

test('removing a rover clears driver sets, reverse membership, rooms, and turns', () => {
  const roverId = 'rover-one';
  const socketId = 'driver-one';
  const leftRooms = [];
  const removedTurns = [];
  const driverEvents = [];
  const socket = {
    id: socketId,
    leave: (room) => leftRooms.push(room),
  };
  const record = {
    id: roverId,
    room: `rover:${roverId}`,
    drivers: new Set([socketId]),
  };
  const rovers = new Map([[roverId, record]]);
  const socketToRovers = new Map([[socketId, new Set([roverId])]]);
  const managerEvents = new EventEmitter();
  managerEvents.on('driver', (event) => driverEvents.push(event));

  const lifecycle = createRoverLifecycle({
    io: { sockets: { sockets: new Map([[socketId, socket]]) } },
    rovers,
    socketToRovers,
    managerEvents,
    turnService: {
      driverRemoved: (removedRoverId, removedSocketId) => {
        removedTurns.push([removedRoverId, removedSocketId]);
      },
    },
    isAdmin: () => false,
    sendAlert: () => {},
    ALERT_COLOR: '#000000',
    getMode: () => 'public',
    getControlDenialReason: () => null,
  });

  /* Mirror rosterLifecycle's ordering: the public record is gone before the
     captured record is supplied for complete membership cleanup. */
  rovers.delete(roverId);
  const removedDriverIds = lifecycle.removeRoverDrivers(roverId, record);

  assert.deepEqual(removedDriverIds, [socketId]);
  assert.equal(record.drivers.size, 0);
  assert.equal(socketToRovers.has(socketId), false);
  assert.deepEqual(leftRooms, [`rover:${roverId}`]);
  assert.deepEqual(removedTurns, [[roverId, socketId]]);
  assert.deepEqual(driverEvents, [
    { socketId, roverId, action: 'remove' },
  ]);
});
