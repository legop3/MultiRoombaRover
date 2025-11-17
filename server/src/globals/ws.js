const { WebSocketServer } = require('ws');
const { httpServer } = require('./http');
const logger = require('./logger');

const roverWSS = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/rover')) {
    roverWSS.handleUpgrade(req, socket, head, (ws) => {
      roverWSS.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

roverWSS.on('connection', () => {
  logger.info('Rover websocket connected');
});

module.exports = roverWSS;
