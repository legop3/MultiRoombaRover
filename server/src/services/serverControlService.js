const { spawn } = require('child_process');
const io = require('../globals/io');
const logger = require('../globals/logger').child('serverControlService');
const { isAdmin } = require('./roleService');
const { sendAlert } = require('./alertService');

const ALERT_COLOR = '#ff5722';
let rebootPending = false;

function scheduleSystemReboot() {
  if (rebootPending) {
    throw new Error('Server reboot already pending');
  }
  rebootPending = true;

  setTimeout(() => {
    logger.warn('Issuing system reboot command');
    try {
      const child = spawn('systemctl', ['reboot'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (err) {
      rebootPending = false;
      logger.error('Server reboot command failed', err.message);
    }
  }, 400);
}

io.on('connection', (socket) => {
  socket.on('server:reboot', (_, cb = () => {}) => {
    if (!isAdmin(socket)) {
      cb({ error: 'Not authorized' });
      return;
    }
    try {
      scheduleSystemReboot();
      const who = socket?.data?.user?.username || socket.id;
      logger.warn('Server reboot requested', { by: who });
      sendAlert({
        color: ALERT_COLOR,
        title: 'Server Reboot',
        message: `Reboot requested by ${who}`,
      });
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

