const http = require('http');
const path = require('path');
const express = require('express');
const morgan = require('morgan');
const { Server: SocketIOServer } = require('socket.io');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { parseSensorFrame } = require('./sensorDecoder');

const PORT = process.env.PORT || 8080;

const app = express();
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
});

const roverWSS = new WebSocketServer({ noServer: true });
const rovers = new Map();
const pendingCommands = new Map();

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/rover')) {
    roverWSS.handleUpgrade(req, socket, head, (ws) => {
      roverWSS.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

roverWSS.on('connection', (ws) => {
  handleRoverConnection(ws);
});

function handleRoverConnection(ws) {
  let roverId = null;
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    switch (msg.type) {
      case 'hello':
        roverId = msg.name;
        rovers.set(roverId, {
          id: roverId,
          ws,
          meta: msg,
          lastSensor: null,
          lastSeen: Date.now(),
        });
        broadcastRoster();
        break;
      case 'sensor':
        if (!roverId || !rovers.has(roverId)) {
          return;
        }
        const rover = rovers.get(roverId);
        const decoded = parseSensorFrame(msg.data);
        rover.lastSensor = { raw: msg, decoded };
        rover.lastSeen = Date.now();
        io.emit('sensorFrame', { roverId, frame: msg, sensors: decoded });
        break;
      case 'ack':
        if (msg.id && pendingCommands.has(msg.id)) {
          const pending = pendingCommands.get(msg.id);
          pendingCommands.delete(msg.id);
          io.emit('commandAck', { roverId: pending.roverId, id: msg.id, status: msg.status, error: msg.error });
        }
        break;
      case 'event':
        if (!roverId) {
          return;
        }
        io.emit('roverEvent', {
          roverId,
          event: msg.event,
          ts: msg.ts || Date.now(),
          data: msg.data || {},
        });
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (roverId) {
      rovers.delete(roverId);
      broadcastRoster();
    }
  });
}

io.on('connection', (socket) => {
  socket.emit('rovers', getRoster());

  socket.on('command', (payload = {}, cb = () => {}) => {
    try {
      const commandId = routeCommand(payload);
      cb({ id: commandId });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

function getRoster() {
  return Array.from(rovers.values()).map(({ id, meta, lastSeen }) => ({
    id,
    name: meta?.name ?? id,
    battery: meta?.battery ?? null,
    maxWheelSpeed: meta?.maxWheelSpeed ?? null,
    media: meta?.media ?? null,
    lastSeen,
  }));
}

function broadcastRoster() {
  io.emit('rovers', getRoster());
}

function routeCommand(payload) {
  const { roverId, type, data } = payload;
  if (!roverId) {
    throw new Error('roverId missing');
  }
  if (!rovers.has(roverId)) {
    throw new Error(`rover ${roverId} not connected`);
  }
  const rover = rovers.get(roverId);
  const message = buildCommand(type, data);
  const id = uuidv4();
  message.id = id;
  rover.ws.send(JSON.stringify(message));
  pendingCommands.set(id, { roverId, issuedAt: Date.now(), type });
  return id;
}

function buildCommand(type, data = {}) {
  switch (type) {
    case 'drive':
      return { type: 'drive', driveDirect: { left: data.left || 0, right: data.right || 0 } };
    case 'motors':
      return {
        type: 'motors',
        motorPwm: {
          main: data.main ?? 0,
          side: data.side ?? 0,
          vacuum: data.vacuum ?? 0,
        },
      };
    case 'raw':
      return { type: 'raw', raw: Buffer.from(data.bytes || []).toString('base64') };
    case 'sensorStream':
      return { type: 'sensorStream', sensorStream: { enable: Boolean(data.enable) } };
    case 'media':
      if (!data || !data.action) {
        throw new Error('media action required');
      }
      return { type: 'media', media: { action: data.action } };
    default:
      throw new Error(`unknown command type: ${type}`);
  }
}

if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`Server listening on :${PORT}`);
  });
}

module.exports = {
  httpServer,
  io,
  routeCommand,
};
