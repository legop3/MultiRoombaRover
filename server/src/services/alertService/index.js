// alert Service
// Purpose: Defines the alert Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const io = require('../../globals/io');

function sendAlert({ color, title, message, ts = Date.now() }) {
  const payload = {
    color: color || '#2196f3',
    title,
    message,
    ts,
  };
  io.emit('alert', payload);
  io.emit('alert:new', { id: `${ts}-${Math.random().toString(36).slice(2)}`, ...payload });
}

module.exports = {
  sendAlert,
};
