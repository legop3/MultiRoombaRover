const bcrypt = require('bcrypt');
const io = require('../globals/io');
const logger = require('../globals/logger').child('authService');
const { loadConfig } = require('../helpers/configLoader');
const { clearLockdownTimer } = require('./lockdownGuard');
const { setRole } = require('./roleService');

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
  const requestedRole = socket.handshake?.query?.role;
  const initialRole = requestedRole === 'spectator' ? 'spectator' : 'user';
  setRole(socket, initialRole);
  logger.info('Socket connected with role', socket.id, initialRole);
  socket.emit('auth:role', { role: initialRole });
  socket.on('auth:login', async ({ username, password }, cb = () => {}) => {
    try {
      const admin = await authenticate(username, password);
      const role = admin.lockdown ? 'lockdown' : 'admin';
      socket.data.user = { username: admin.username, discordId: admin.discord_id };
      setRole(socket, role);
      socket.emit('auth:role', { role });
      clearLockdownTimer(socket);
      logger.info('Login success', socket.id, role);
      cb({ success: true, role: socket.data.role });
    } catch (err) {
      logger.warn('Login failed', socket.id, err.message);
      cb({ success: false, error: err.message });
    }
  });

  function handleRoleChange({ role } = {}, cb = () => {}) {
    if (role === 'spectator' || role === 'user') {
      setRole(socket, role);
      socket.emit('auth:role', { role });
      logger.info('Role changed via client request', socket.id, role);
      cb({ success: true, role });
    } else {
      cb({ error: 'Invalid role' });
    }
  }

  socket.on('role:set', handleRoleChange);
  socket.on('session:setRole', handleRoleChange);
});

module.exports = {
  isAdmin,
  isLockdownAdmin,
  authenticate,
};
