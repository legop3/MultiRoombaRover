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

// Allow more service listeners without warnings.
io.sockets.setMaxListeners(30);
io.of('/').setMaxListeners(30);

module.exports = io;
