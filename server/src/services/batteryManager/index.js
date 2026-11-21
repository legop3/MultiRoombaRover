const { managerEvents, lockRover } = require('../roverManager');
const { publishEvent } = require('../eventBus');
// Edge notifications and administrative locks belong to the server. All
// battery facts and charging recovery history belong to the rover.
managerEvents.on('state', ({ roverId, state, previous, record, batteryState }) => {
  const b = state.battery, old = previous?.battery;
  const emit = type => publishEvent({ source: 'batteryManager', type, payload: { roverId, batteryState } });
  if (b.low === true && old?.low !== true) emit('battery.warn');
  if (b.critical === true && old?.critical !== true) emit('battery.urgent');
  if (state.docked === true && previous?.docked !== true) emit('battery.docked');
  if (state.docked === false && previous?.docked === true) emit('battery.undocked');
  if (b.charging === true && old?.charging !== true) emit('battery.charging.start');
  if (b.charging === false && old?.charging === true) emit('battery.charging.stop');
  if (b.needsCharge === true && state.docked === true && b.charging === true && b.percent != null && b.percent < 99 && !record.locked && record.lockReason == null) {
    lockRover(roverId, true, { reason: 'battery' }); emit('battery.locked');
  }
  if (b.needsCharge === false && record.lockReason === 'battery') {
    lockRover(roverId, false, { reason: 'battery' }); emit('battery.unlocked');
  }
  if (state.docked === true && old?.needsCharge === true && b.needsCharge === false) emit('battery.chargeComplete');
});
