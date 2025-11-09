import path from 'path';
import http from 'http';
import dgram from 'dgram';
import express from 'express';
import { Server as SocketIo } from 'socket.io';
import { fileURLToPath } from 'url';

import {
  CONTROL_BIND_PORT,
  CONTROL_CONSTANTS,
  CONTROL_STREAM_HZ,
  TELEMETRY_BIND_PORT,
} from './constants.js';
import { loadRobots } from './robotRegistry.js';
import { buildControlPacket } from './udpPackets.js';
import { decodeTelemetry } from './telemetryDecoder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIo(server, {
  cors: {
    origin: '*',
  },
});

const robots = loadRobots();
if (robots.length === 0) {
  throw new Error('No robots configured. Add at least one entry to server/robots.json');
}

const robotState = new Map();
const telemetryState = new Map();

robots.forEach((robot) => {
  robotState.set(robot.id, {
    config: robot,
    seq: 0,
    leftMmps: 0,
    rightMmps: 0,
    pendingMode: CONTROL_CONSTANTS.MODES.NO_CHANGE,
    pendingActions: 0,
    songSlot: 0,
    lastKnownHost: robot.host || null,
    lastKnownPort: robot.controlPort,
  });
});

const controlSocket = dgram.createSocket('udp4');
controlSocket.on('error', (err) => {
  console.error('[control] socket error', err);
});
controlSocket.bind(CONTROL_BIND_PORT, () => {
  console.log(`[control] bound on port ${CONTROL_BIND_PORT}`);
});

const telemetrySocket = dgram.createSocket('udp4');
telemetrySocket.on('message', (msg, rinfo) => {
  try {
    const telemetry = decodeTelemetry(msg);
    const robotId = telemetry.header.robotId || rinfo.address;
    telemetryState.set(robotId, telemetry);
    const state = robotState.get(robotId);
    if (state) {
      state.lastKnownHost = rinfo.address;
      state.lastKnownPort = state.config.controlPort;
    } else {
      console.warn(`[telemetry] received frame from unknown robot ${robotId} (${rinfo.address})`);
    }
    io.emit('telemetry', { robotId, telemetry });
  } catch (err) {
    console.warn('[telemetry] failed to decode packet', err.message);
  }
});
telemetrySocket.bind(TELEMETRY_BIND_PORT, () => {
  console.log(`[telemetry] listening on port ${TELEMETRY_BIND_PORT}`);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateDrive(robotId, left, right) {
  const state = robotState.get(robotId);
  if (!state) {
    return;
  }
  const limit = state.config.maxWheelSpeed || CONTROL_CONSTANTS.MAX_SPEED_MMPS;
  const parsedLeft = Number(left) || 0;
  const parsedRight = Number(right) || 0;
  state.leftMmps = clamp(parsedLeft, -limit, limit);
  state.rightMmps = clamp(parsedRight, -limit, limit);
}

function requestMode(robotId, mode) {
  const state = robotState.get(robotId);
  if (!state) {
    return;
  }
  state.pendingMode = mode;
}

function triggerAction(robotId, actionBit, songSlot = 0) {
  const state = robotState.get(robotId);
  if (!state) {
    return;
  }
  state.pendingActions |= actionBit;
  state.songSlot = songSlot;
}

function sendControlFrame(robotId) {
  const state = robotState.get(robotId);
  if (!state) {
    return;
  }
  if (!state.lastKnownHost) {
    return; // have not yet received telemetry -> cannot address robot
  }
  const packet = buildControlPacket({
    seq: state.seq++,
    leftMmps: state.leftMmps,
    rightMmps: state.rightMmps,
    mode: state.pendingMode,
    actions: state.pendingActions,
    songSlot: state.songSlot,
  });
  controlSocket.send(
    packet,
    0,
    packet.length,
    state.lastKnownPort,
    state.lastKnownHost,
    (err) => {
      if (err) {
        console.warn(`[control] failed to send to ${state.lastKnownHost}`, err.message);
      }
    },
  );
  state.pendingMode = CONTROL_CONSTANTS.MODES.NO_CHANGE;
  state.pendingActions = 0;
}

setInterval(() => {
  for (const robot of robots) {
    sendControlFrame(robot.id);
  }
}, Math.round(1000 / CONTROL_STREAM_HZ));

io.on('connection', (socket) => {
  console.log('[socket] client connected');
  socket.emit('robots', robots);
  socket.emit(
    'telemetrySnapshot',
    Array.from(telemetryState.entries()).map(([robotId, telemetry]) => ({
      robotId,
      telemetry,
    })),
  );

  socket.on('drive', ({ robotId, left = 0, right = 0 } = {}) => {
    updateDrive(robotId, left, right);
  });

  socket.on('mode', ({ robotId, mode }) => {
    const modes = CONTROL_CONSTANTS.MODES;
    const requested = mode
      ? modes[mode.toUpperCase()] ?? modes.NO_CHANGE
      : modes.NO_CHANGE;
    requestMode(robotId, requested);
  });

  socket.on('seekDock', ({ robotId }) => {
    triggerAction(robotId, CONTROL_CONSTANTS.ACTIONS.SEEK_DOCK);
  });

  socket.on('enableOi', ({ robotId }) => {
    triggerAction(robotId, CONTROL_CONSTANTS.ACTIONS.ENABLE_OI);
  });

  socket.on('playSong', ({ robotId, slot = 0 }) => {
    triggerAction(robotId, CONTROL_CONSTANTS.ACTIONS.PLAY_SONG, slot);
  });

  socket.on('disconnect', () => {
    console.log('[socket] client disconnected');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
