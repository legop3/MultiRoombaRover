const { Server: SocketIOServer } = require('socket.io');
const { httpServer } = require('./http');

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
});

// Allow more service listeners without warnings.
io.sockets.setMaxListeners(30);
io.of('/').setMaxListeners(30);

module.exports = io;
