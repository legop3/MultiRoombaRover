// PTZ Camera Service
// Purpose: Owns the single Reolink TrackMix PTZ camera integration, including queueing, ONVIF control, Reolink-only light controls, stream publishing, snapshots, and session state.
// Scope: This is intentionally a one-camera feature, not a generic ONVIF camera framework.
const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { Cam } = require('onvif');
const { ReolinkClient } = require('reolink-nvr-api');

const io = require('../../globals/io');
const logger = require('../../globals/logger').child('ptzCamera');
const { loadConfig } = require('../../helpers/configLoader');
const { isFeatureEnabled } = require('../../helpers/features');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('../roleService');
const { isVerified } = require('../verificationService');
const { getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');
const roverManager = require('../roverManager');
const assignmentService = require('../assignmentService');
const videoSessions = require('../videoSessions');

const PTZ_CAMERA_ID = 'ptz-camera';
const PTZ_STREAM_PATH = 'ptz-camera';
const DEFAULT_ONVIF_PORT = 8000;
const DEFAULT_PROFILE_TOKEN = '003';
const DEFAULT_TURN_DURATION_MS = 5 * 60 * 1000;
const DOCK_GRACE_MS = 60 * 1000;
const SNAPSHOT_DIR = process.env.ROVER_SNAPSHOT_DIR || '/var/lib/rover-snapshots';
const SNAPSHOT_POLL_MS = 300;
const SNAPSHOT_STREAM_INTERVAL_MS = 2000;

const events = new EventEmitter();
const config = loadConfig();
const cameraConfig = config.ptzCamera || {};
const enabled = isFeatureEnabled('ptzCamera');

const state = {
  initialized: false,
  initializing: false,
  error: null,
  profileToken: String(cameraConfig.profileToken || DEFAULT_PROFILE_TOKEN),
  rtspUri: null,
  streamPath: PTZ_STREAM_PATH,
  operatorSocketId: null,
  queue: [],
  deadline: null,
  blocked: null,
  status: null,
  light: null,
  ir: null,
};

let onvifCam = null;
let reolinkClient = null;
let turnTimer = null;
let blockedTimer = null;
let publisherProcess = null;
let publisherRestartTimer = null;
let snapshotTimer = null;
let lastSnapshotState = null;
const snapshotSubscribers = new Map();
const socketSnapshotSubscriptions = new Map();
const snapshotLastSentBySocket = new Map();

function emitChange(reason = 'change') {
  events.emit('change', { reason, state: getPublicState() });
}

function clampUnit(value) {
  const number = Number(value) || 0;
  return Math.max(-1, Math.min(1, number));
}

function getTurnDurationMs() {
  const configured = Number(cameraConfig.turnDurationMs);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TURN_DURATION_MS;
}

function passesMode(socket) {
  const mode = getMode();
  if (mode === MODES.LOCKDOWN) return isLockdownAdmin(socket);
  if (mode === MODES.ADMIN) {
    const role = getRole(socket);
    return role === 'spectator' || isAdmin(socket);
  }
  return true;
}

function canUsePtzFeature(socket) {
  if (!enabled || !socket) return false;
  if (!passesMode(socket)) return false;
  /*
    The camera is a VIP feature during normal operation. Admins are allowed so
    maintenance and testing do not depend on the verification database state,
    while lockdown mode is already narrowed to lockdown admins by passesMode().
  */
  return Boolean(isVerified(socket) || isAdmin(socket) || isLockdownAdmin(socket));
}

function getSocketLabel(socketId) {
  const socket = io.sockets.sockets.get(socketId);
  return socket?.data?.nickname || socket?.data?.user?.username || socketId || null;
}

function getPublicState(socket = null) {
  const socketId = socket?.id || null;
  const queue = state.queue.map((id) => ({
    socketId: id,
    label: getSocketLabel(id),
  }));
  return {
    enabled,
    id: PTZ_CAMERA_ID,
    name: cameraConfig.name || 'PTZ Camera',
    initialized: state.initialized,
    error: state.error,
    streamPath: state.streamPath,
    operatorSocketId: state.operatorSocketId,
    operatorLabel: getSocketLabel(state.operatorSocketId),
    queue,
    deadline: state.deadline,
    blocked: state.blocked,
    status: state.status,
    light: state.light,
    ir: state.ir,
    isOperator: Boolean(socketId && state.operatorSocketId === socketId),
    queuedPosition: socketId ? state.queue.indexOf(socketId) + 1 || null : null,
    canUse: socket ? canUsePtzFeature(socket) : false,
  };
}

function callOnvif(method, options = {}) {
  return new Promise((resolve, reject) => {
    if (!onvifCam || typeof onvifCam[method] !== 'function') {
      reject(new Error('ONVIF camera is not ready'));
      return;
    }
    onvifCam[method](options, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function connectOnvif() {
  return new Promise((resolve, reject) => {
    const cam = new Cam({
      hostname: cameraConfig.host,
      username: cameraConfig.username,
      password: cameraConfig.password,
      port: Number(cameraConfig.onvifPort) || DEFAULT_ONVIF_PORT,
      timeout: 10000,
    }, function handleConnect(err) {
      if (err) reject(err);
      else resolve(this);
    });
    return cam;
  });
}

async function getStreamUriForProfile(cam) {
  const profileToken = String(cameraConfig.profileToken || DEFAULT_PROFILE_TOKEN);
  return new Promise((resolve, reject) => {
    cam.getStreamUri({ profileToken, protocol: 'RTSP' }, (err, data) => {
      if (err) reject(err);
      else resolve(data?.uri || data?.Uri || '');
    });
  });
}

function addCredentialsToRtsp(rawUri) {
  const parsed = new URL(rawUri);
  if (!parsed.username) parsed.username = cameraConfig.username;
  if (!parsed.password) parsed.password = cameraConfig.password;
  return parsed.toString();
}

function stopPublisher() {
  if (publisherRestartTimer) {
    clearTimeout(publisherRestartTimer);
    publisherRestartTimer = null;
  }
  if (publisherProcess) {
    try {
      publisherProcess.kill('SIGTERM');
    } catch {}
    publisherProcess = null;
  }
}

function startPublisher() {
  if (!enabled || !state.rtspUri || publisherProcess) return;
  const input = addCredentialsToRtsp(state.rtspUri);
  const output = `srt://127.0.0.1:9000?streamid=publish:${encodeURIComponent(PTZ_STREAM_PATH)}`;
  /*
    MediaMTX already treats SRT publishers as trusted local media producers.
    Copying the autotrack stream keeps the full-resolution camera feed intact;
    if browser H.265 support becomes a problem later, this is the one place to
    add a transcode without changing PTZ ownership or UI code.
  */
  const proc = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostdin',
    '-rtsp_transport',
    'tcp',
    '-i',
    input,
    '-c',
    'copy',
    '-f',
    'mpegts',
    output,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  publisherProcess = proc;
  proc.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) logger.warn('publisher stderr', { text: text.slice(0, 500) });
  });
  proc.on('exit', (code, signal) => {
    if (publisherProcess === proc) publisherProcess = null;
    logger.warn('publisher exited', { code, signal });
    if (enabled && state.rtspUri) {
      publisherRestartTimer = setTimeout(() => {
        publisherRestartTimer = null;
        startPublisher();
      }, 1500);
    }
  });
  logger.info('Started PTZ stream publisher', { streamPath: PTZ_STREAM_PATH });
}

async function ensureReolinkClient() {
  if (reolinkClient) return reolinkClient;
  reolinkClient = new ReolinkClient({
    host: cameraConfig.host,
    username: cameraConfig.username,
    password: cameraConfig.password,
    mode: 'long',
    insecure: true,
    timeout: 10000,
  });
  await reolinkClient.login();
  return reolinkClient;
}

async function refreshVendorState() {
  if (!enabled) return;
  const client = await ensureReolinkClient();
  const [white, ir] = await Promise.all([
    client.api('GetWhiteLed', { channel: 0 }).catch((err) => ({ error: err.message })),
    client.api('GetIrLights', { channel: 0 }).catch((err) => ({ error: err.message })),
  ]);
  state.light = white?.WhiteLed || white || null;
  state.ir = ir?.IrLights || ir || null;
}

async function initialize() {
  if (!enabled || state.initialized || state.initializing) return;
  state.initializing = true;
  try {
    onvifCam = await connectOnvif();
    state.rtspUri = await getStreamUriForProfile(onvifCam);
    await refreshVendorState();
    state.initialized = true;
    state.error = null;
    startPublisher();
    startSnapshotPolling();
    logger.info('PTZ camera initialized', {
      host: cameraConfig.host,
      profileToken: state.profileToken,
      streamPath: PTZ_STREAM_PATH,
    });
  } catch (err) {
    state.error = err.message || String(err);
    logger.warn('PTZ camera initialization failed', { error: state.error });
  } finally {
    state.initializing = false;
    emitChange('initialize');
  }
}

function clearTurnTimer() {
  if (turnTimer) clearTimeout(turnTimer);
  turnTimer = null;
}

function clearBlockedTimer() {
  if (blockedTimer) clearTimeout(blockedTimer);
  blockedTimer = null;
}

function removeFromQueue(socketId) {
  state.queue = state.queue.filter((id) => id !== socketId);
}

function revokeOperator(reason = 'release') {
  if (!state.operatorSocketId) return;
  const previous = state.operatorSocketId;
  state.operatorSocketId = null;
  state.deadline = null;
  clearTurnTimer();
  videoSessions.revokeWhere((info) => info.socketId === previous && info.sourceType === 'ptz');
  callOnvif('stop', { profileToken: state.profileToken, panTilt: true, zoom: true }).catch(() => {});
  events.emit('operator', { socketId: previous, action: 'release', reason });
}

function activateOperator(socket) {
  revokeOperator('handoff');
  removeFromQueue(socket.id);
  /*
    PTZ operation is mutually exclusive with rover ownership. Releasing through
    assignmentService preserves the existing queue/control cleanup rules instead
    of directly mutating rover manager state.
  */
  roverManager.getRoversForSocket(socket.id).forEach((roverId) => {
    assignmentService.forceRelease(roverId, socket.id);
  });
  state.operatorSocketId = socket.id;
  state.deadline = Date.now() + getTurnDurationMs();
  turnTimer = setTimeout(() => {
    revokeOperator('turn-expired');
    advanceQueue('turn-expired');
  }, getTurnDurationMs());
  socket.emit('ptzCamera:turn', { status: 'active', deadline: state.deadline });
  events.emit('operator', { socketId: socket.id, action: 'active' });
  emitChange('operator-active');
}

function advanceQueue(reason = 'advance') {
  clearBlockedTimer();
  state.blocked = null;
  if (state.operatorSocketId || !state.queue.length) {
    emitChange(reason);
    return;
  }
  const nextId = state.queue[0];
  const socket = io.sockets.sockets.get(nextId);
  if (!socket || !canUsePtzFeature(socket)) {
    removeFromQueue(nextId);
    advanceQueue('drop-invalid');
    return;
  }
  const leave = roverManager.canLeaveCurrentRover(socket);
  if (!leave.ok) {
    /*
      A queued user may reach the camera while still being the last person on an
      undocked rover. Hold their queue slot briefly so they can dock; if they do
      not satisfy the shared rover-leave rule, rotate them to the back and let
      the next person try.
    */
    state.blocked = {
      socketId: socket.id,
      label: getSocketLabel(socket.id),
      roverId: leave.currentId || null,
      message: leave.message,
      until: Date.now() + DOCK_GRACE_MS,
    };
    socket.emit('ptzCamera:dockRequired', state.blocked);
    blockedTimer = setTimeout(() => {
      const [blockedId] = state.queue.splice(0, 1);
      if (blockedId) state.queue.push(blockedId);
      state.blocked = null;
      advanceQueue('dock-grace-expired');
    }, DOCK_GRACE_MS);
    emitChange('dock-required');
    return;
  }
  activateOperator(socket);
}

async function claim(socket) {
  if (!canUsePtzFeature(socket)) throw new Error('Not authorized for PTZ camera');
  await initialize();
  if (!state.initialized) throw new Error(state.error || 'PTZ camera is not ready');
  if (state.operatorSocketId === socket.id) return getPublicState(socket);
  if (state.operatorSocketId) {
    if (!state.queue.includes(socket.id)) state.queue.push(socket.id);
    emitChange('queue-join');
    return getPublicState(socket);
  }
  if (!state.queue.includes(socket.id)) state.queue.unshift(socket.id);
  advanceQueue('claim');
  return getPublicState(socket);
}

async function release(socket) {
  if (state.operatorSocketId === socket.id || isAdmin(socket)) {
    revokeOperator('manual-release');
    advanceQueue('manual-release');
  } else {
    removeFromQueue(socket.id);
    emitChange('queue-leave');
  }
  return getPublicState(socket);
}

function requireOperator(socket) {
  if (!enabled) throw new Error('PTZ camera disabled');
  if (!passesMode(socket)) throw new Error('Not authorized for PTZ camera');
  if (!socket || state.operatorSocketId !== socket.id) throw new Error('Not the PTZ operator');
}

async function move(socket, payload = {}) {
  requireOperator(socket);
  await initialize();
  const x = clampUnit(payload.pan ?? payload.x);
  const y = clampUnit(payload.tilt ?? payload.y);
  const zoom = clampUnit(payload.zoom);
  await callOnvif('continuousMove', {
    profileToken: state.profileToken,
    x,
    y,
    zoom,
    timeout: 1000,
  });
  return { ok: true };
}

async function stop(socket) {
  requireOperator(socket);
  await callOnvif('stop', { profileToken: state.profileToken, panTilt: true, zoom: true });
  return { ok: true };
}

async function getStatus(socket) {
  if (!passesMode(socket)) throw new Error('Not authorized for PTZ camera');
  await initialize();
  const status = await callOnvif('getStatus', { profileToken: state.profileToken });
  state.status = status || null;
  emitChange('status');
  return state.status;
}

async function setSpotlight(socket, payload = {}) {
  requireOperator(socket);
  const client = await ensureReolinkClient();
  const current = (await client.api('GetWhiteLed', { channel: 0 })).WhiteLed;
  const next = {
    ...current,
    channel: 0,
    state: payload.state === undefined ? (current.state ? 0 : 1) : Number(Boolean(payload.state)),
  };
  if (Number.isFinite(Number(payload.bright))) {
    next.bright = Math.max(0, Math.min(100, Number(payload.bright)));
  }
  await client.api('SetWhiteLed', { WhiteLed: next });
  await refreshVendorState();
  emitChange('light');
  return state.light;
}

async function setIr(socket, payload = {}) {
  requireOperator(socket);
  const nextState = String(payload.state || '').toLowerCase() === 'off' ? 'Off' : 'Auto';
  const client = await ensureReolinkClient();
  await client.api('SetIrLights', { IrLights: { state: nextState } });
  await refreshVendorState();
  emitChange('ir');
  return state.ir;
}

function canRequestLiveVideo(socket) {
  if (!enabled || !passesMode(socket)) return false;
  if (state.operatorSocketId === socket?.id) return true;
  if (isAdmin(socket) || isLockdownAdmin(socket)) return true;
  return isLocalNetwork(getSocketIp(socket));
}

function getSnapshotPath() {
  return path.join(SNAPSHOT_DIR, `${PTZ_STREAM_PATH}.jpg`);
}

async function pollSnapshot() {
  try {
    const filePath = getSnapshotPath();
    const stats = await fs.stat(filePath);
    if (lastSnapshotState?.mtimeMs && stats.mtimeMs <= lastSnapshotState.mtimeMs) return;
    const buffer = await fs.readFile(filePath);
    lastSnapshotState = { frame: buffer, ts: stats.mtimeMs || Date.now(), error: null, mtimeMs: stats.mtimeMs };
    events.emit('snapshot:frame', { id: PTZ_CAMERA_ID, buffer, ts: lastSnapshotState.ts });
  } catch (err) {
    lastSnapshotState = {
      ...(lastSnapshotState || {}),
      error: err.code === 'ENOENT' ? 'Snapshot missing' : err.message,
    };
    events.emit('snapshot:status', { id: PTZ_CAMERA_ID, error: lastSnapshotState.error });
  }
}

function startSnapshotPolling() {
  if (snapshotTimer) return;
  snapshotTimer = setInterval(() => {
    pollSnapshot().catch((err) => logger.warn('snapshot poll failed', { error: err.message }));
  }, SNAPSHOT_POLL_MS);
}

function addSnapshotSubscription(socket) {
  if (!snapshotSubscribers.has(PTZ_CAMERA_ID)) snapshotSubscribers.set(PTZ_CAMERA_ID, new Set());
  snapshotSubscribers.get(PTZ_CAMERA_ID).add(socket.id);
  if (!socketSnapshotSubscriptions.has(socket.id)) socketSnapshotSubscriptions.set(socket.id, new Set());
  socketSnapshotSubscriptions.get(socket.id).add(PTZ_CAMERA_ID);
}

function removeSnapshotSubscriptions(socketId) {
  const bucket = socketSnapshotSubscriptions.get(socketId);
  if (!bucket) return;
  bucket.forEach((id) => {
    const subscribers = snapshotSubscribers.get(id);
    if (subscribers) {
      subscribers.delete(socketId);
      if (!subscribers.size) snapshotSubscribers.delete(id);
    }
  });
  socketSnapshotSubscriptions.delete(socketId);
  snapshotLastSentBySocket.delete(socketId);
}

function sendSnapshotFrame(socket, buffer, ts) {
  socket.emit('ptzCamera:snapshotFrame', { id: PTZ_CAMERA_ID, ts }, buffer);
}

events.on('snapshot:frame', ({ buffer, ts }) => {
  const subscribers = snapshotSubscribers.get(PTZ_CAMERA_ID);
  if (!subscribers || !buffer) return;
  subscribers.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    const last = snapshotLastSentBySocket.get(socketId) || 0;
    const now = ts || Date.now();
    if (now - last < SNAPSHOT_STREAM_INTERVAL_MS) return;
    snapshotLastSentBySocket.set(socketId, now);
    sendSnapshotFrame(socket, buffer, ts);
  });
});

events.on('snapshot:status', ({ error }) => {
  const subscribers = snapshotSubscribers.get(PTZ_CAMERA_ID);
  if (!subscribers) return;
  subscribers.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.emit('ptzCamera:snapshotStatus', { id: PTZ_CAMERA_ID, error: error || null });
  });
});

function registerSocketHandlers() {
  io.on('connection', (socket) => {
    socket.on('ptzCamera:claim', async (_payload = {}, cb = () => {}) => {
      try {
        cb({ ok: true, state: await claim(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:release', async (_payload = {}, cb = () => {}) => {
      try {
        cb({ ok: true, state: await release(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:move', async (payload = {}, cb = () => {}) => {
      try {
        cb(await move(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:stop', async (_payload = {}, cb = () => {}) => {
      try {
        cb(await stop(socket));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:status', async (_payload = {}, cb = () => {}) => {
      try {
        cb({ ok: true, status: await getStatus(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:spotlight', async (payload = {}, cb = () => {}) => {
      try {
        cb({ ok: true, light: await setSpotlight(socket, payload) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:ir', async (payload = {}, cb = () => {}) => {
      try {
        cb({ ok: true, ir: await setIr(socket, payload) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:snapshotSubscribe', (_payload = {}, cb = () => {}) => {
      try {
        if (!passesMode(socket)) throw new Error('Not authorized for PTZ snapshots');
        addSnapshotSubscription(socket);
        if (lastSnapshotState?.frame) sendSnapshotFrame(socket, lastSnapshotState.frame, lastSnapshotState.ts);
        cb({ ok: true, subscribed: [PTZ_CAMERA_ID] });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:snapshotUnsubscribe', () => {
      removeSnapshotSubscriptions(socket.id);
    });
    socket.on('disconnect', () => {
      if (state.operatorSocketId === socket.id) {
        revokeOperator('disconnect');
        advanceQueue('disconnect');
      }
      removeFromQueue(socket.id);
      removeSnapshotSubscriptions(socket.id);
      emitChange('disconnect');
    });
  });
}

modeEvents.on('change', (mode) => {
  if (mode !== MODES.LOCKDOWN) return;
  if (state.operatorSocketId) {
    const socket = io.sockets.sockets.get(state.operatorSocketId);
    if (!socket || !isLockdownAdmin(socket)) revokeOperator('lockdown');
  }
  state.queue = state.queue.filter((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    return socket && isLockdownAdmin(socket);
  });
  videoSessions.revokeWhere((info) => {
    if (info.sourceType !== 'ptz') return false;
    const socket = io.sockets.sockets.get(info.socketId);
    return !socket || !isLockdownAdmin(socket);
  });
  Array.from(socketSnapshotSubscriptions.keys()).forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket || !isLockdownAdmin(socket)) removeSnapshotSubscriptions(socketId);
  });
  emitChange('lockdown');
});

registerSocketHandlers();
if (enabled) {
  initialize();
}

module.exports = {
  PTZ_CAMERA_ID,
  PTZ_STREAM_PATH,
  ptzCameraEvents: events,
  getPublicState,
  canRequestLiveVideo,
  getReplaySource: () => enabled ? { type: 'ptz', id: PTZ_CAMERA_ID, label: cameraConfig.name || 'PTZ Camera' } : null,
  getReplayWorkerSource: () => enabled ? {
    id: PTZ_CAMERA_ID,
    sourceType: 'ptz',
    kind: 'video',
    label: cameraConfig.name || 'PTZ Camera',
    inputUrl: `srt://127.0.0.1:9000?streamid=read:${encodeURIComponent(PTZ_STREAM_PATH)}`,
  } : null,
};
