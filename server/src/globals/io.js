// Global Socket.IO
// Purpose: Stores the singleton Socket.IO server instance for cross-service access. Scope: Exposes getters/setters used during startup wiring and runtime event emission.
const { Server: SocketIOServer } = require('socket.io');
const { httpServer } = require('./http');

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingInterval: 5000,
  pingTimeout: 7000,
  // Upload forwarding sends base64 audio payloads over socket events.
  // Default max payload (~1MB) causes disconnect/reconnect on larger files.
  maxHttpBufferSize: 16 * 1024 * 1024,
});

/*
  Optional feature gateways now remain registered while disabled so an admin
  can enable them live without adding a second listener tree. Forty is a small
  explicit allowance for those one-time service owners, not an unlimited value
  that could hide duplicate registrations during repeated configuration saves.
*/
io.sockets.setMaxListeners(40);
io.of('/').setMaxListeners(40);

module.exports = io;
