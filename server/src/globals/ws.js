// Global WebSocket Server
// Purpose: Stores the shared raw WebSocket server instance for modules that need direct access. Scope: Centralizes setter/getter access for process-wide WS wiring.
const { WebSocketServer } = require('ws');
const { httpServer } = require('./http');
const logger = require('./logger');

const roverWSS = new WebSocketServer({ noServer: true });
const managementWSS = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

httpServer.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const target = path === '/rover/management' ? managementWSS : path === '/rover' ? roverWSS : null;
  if (target) {
    target.handleUpgrade(req, socket, head, (ws) => {
      ws.peerAddress = req.socket.remoteAddress?.replace(/^::ffff:/, '') || null;
      target.emit('connection', ws, req);
    });
  }
});

roverWSS.on('connection', () => {
  logger.info('Rover websocket connected');
});

module.exports = roverWSS;

module.exports.managementWSS = managementWSS;
