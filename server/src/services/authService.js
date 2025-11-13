const bcrypt = require('bcrypt');
const io = require('../globals/io');
const { loadConfig } = require('../helpers/configLoader');
const { clearLockdownTimer } = require('./lockdownGuard');
const { setRole, roleEvents } = require('./roleService');

const config = loadConfig();
const admins = config.admins || [];

function findAdmin(username) {
  return admins.find((admin) => admin.username === username);
}

async function authenticate(username, password) {
  const admin = findAdmin(username);
  if (!admin) {
    throw new Error('Invalid credentials');
  }
  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) {
    throw new Error('Invalid credentials');
  }
  return admin;
}

function isAdmin(socket) {
  return socket?.data?.role === 'admin' || socket?.data?.role === 'lockdown';
}

function isLockdownAdmin(socket) {
  return socket?.data?.role === 'lockdown';
}

io.on('connection', (socket) => {
  setRole(socket, 'user');
  socket.emit('auth:role', { role: 'user' });
  socket.on('auth:login', async ({ username, password }, cb = () => {}) => {
    try {
      const admin = await authenticate(username, password);
      const role = admin.lockdown ? 'lockdown' : 'admin';
      socket.data.user = { username: admin.username, discordId: admin.discord_id };
      setRole(socket, role);
      socket.emit('auth:role', { role });
      clearLockdownTimer(socket);
      cb({ success: true, role: socket.data.role });
    } catch (err) {
      cb({ success: false, error: err.message });
    }
  });

  socket.on('role:set', ({ role }) => {
    if (role === 'spectator' || role === 'user') {
      setRole(socket, role);
      socket.emit('auth:role', { role });
    }
  });
});

module.exports = {
  isAdmin,
  isLockdownAdmin,
  authenticate,
};
