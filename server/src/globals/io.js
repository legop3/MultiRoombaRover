const { Server: SocketIOServer } = require('socket.io');
const { httpServer } = require('./http');

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
});

module.exports = io;
