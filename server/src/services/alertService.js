const io = require('../globals/io');

const COLORS = {
  info: '#2196f3',
  success: '#4caf50',
  warn: '#f0b651',
  error: '#e53935',
};

function sendAlert({ color, title, message, ts = Date.now() }) {
  const payload = {
    color: color || COLORS.info,
    title,
    message,
    ts,
  };
  io.emit('alert', payload);
}

module.exports = {
  COLORS,
  sendAlert,
};
