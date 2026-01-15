const { Server: SocketIOServer } = require('socket.io');
const { httpServer } = require('./http');

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingInterval: 5000,
  pingTimeout: 7000,
});

// Allow more service listeners without warnings.
io.sockets.setMaxListeners(30);
io.of('/').setMaxListeners(30);

module.exports = io;
