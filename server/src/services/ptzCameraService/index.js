// PTZ policy and session facade. Camera IO and participation each own their lifecycle.
const { describeQueue } = require('../turnService/queueDisplay');
const EventEmitter = require('events');

const io = require('../../globals/io');
const logger = require('../../globals/logger').child('ptzCamera');
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const {
  shouldUseSnapshotsForNonTurnVideo,
  shouldUseSnapshotsForExternalSpectatorVideo,
} = require('../../helpers/bandwidthSavings');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { isAdmin, isLockdownAdmin, getRole, roleEvents } = require('../roleService');
const { isVerified, verificationEvents } = require('../verificationService');
const { getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');
const roverManager = require('../roverManager');
const { getOperatingMode, runPtzTurnAction } = require('../operatingModeService');
const videoSessions = require('../videoSessions');

const { createCameraRuntime } = require('./cameraRuntime');
const { createParticipation } = require('./participation');
const { registerSocketGateway } = require('./socketGateway');
const turnLabels = require('./turnLabels');
const PTZ_CAMERA_ID = 'ptz-camera';
const PTZ_STREAM_PATH = 'ptz-camera';
const DEFAULT_TURN_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_REPLAY_ENABLED = true;
const DEFAULT_PTZ_COLOR = '#387bf8';
const SNAPSHOT_STREAM_INTERVAL_MS = 2000;
const events = new EventEmitter();
let cameraConfig = loadConfig().ptzCamera || {};
let enabled = Boolean(cameraConfig.enabled);
const snapshotSubscribers = new Map();
const socketSnapshotSubscriptions = new Map();
const snapshotLastSentBySocket = new Map();
let runtime = createCameraRuntime({ cameraConfig, logger, events, onChange: emitChange, getSocketLabel });
const participation = createParticipation({
  io, events, emitChange, getTurnDurationMs,
  canParticipate: (socket) => getOperatingMode(socket) === 'ptz' && Boolean(socket.data?.ptzEntered) && canUsePtzFeature(socket),
  stopMotion: (reason) => runtime.forceMotionStop(reason),
  revokeVideo: (socketId) => videoSessions.revokeWhere((info) => info.socketId === socketId && info.sourceType === 'ptz'),
});

function emitChange(reason = 'change') {
  events.emit('change', { reason, state: getPublicState() });
}

function getTurnDurationMs() {
  const configured = Number(cameraConfig.turnDurationMs);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TURN_DURATION_MS;
}

function isReplayEnabled() {
  /*
    Keep this as a single helper so the replay source catalog and the replay
    worker catalog cannot drift apart. If PTZ replay is off, the UI should not
    advertise a source that no worker is recording.
  */
  return cameraConfig.replayEnabled === undefined ? DEFAULT_REPLAY_ENABLED : Boolean(cameraConfig.replayEnabled);
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

function accessDenial(socket) {
  if (!enabled) return 'PTZ camera is disabled';
  if (!socket || !passesMode(socket)) return 'PTZ is unavailable in the current server mode';
  if (!canUsePtzFeature(socket)) return 'PTZ requires verification or admin access';
  return null;
}

function describeParticipation(socket) {
  const denialReason = accessDenial(socket);
  const entered = getOperatingMode(socket) === 'ptz' && Boolean(socket?.data?.ptzEntered);
  const isOperator = Boolean(socket && participation.state.operatorSocketId === socket.id);
  const position = socket ? participation.state.queue.indexOf(socket.id) + 1 : 0;
  const currentId = participation.state.operatorSocketId;
  const queue = currentId ? [currentId, ...participation.state.queue] : [...participation.state.queue];
  const ready = enabled && runtime.state.initialized;
  const canControl = !denialReason && entered && isOperator && ready;
  return {
    participation: {
      status: denialReason ? 'unavailable' : !entered ? 'outside' : isOperator ? 'operating' : position ? 'queued' : 'idle',
      entered,
      denialReason,
    },
    permissions: {
      canEnter: !denialReason,
      canRequestTurn: !denialReason && entered && ready && !isOperator && !position,
      canReleaseTurn: isOperator || position > 0,
      canControl,
      canListPresets: !denialReason && ready,
      canCreatePreset: !denialReason && ready,
      canRemovePreset: !denialReason && ready && isAdmin(socket),
    },
    viewMode: socket && canRequestLiveVideo(socket) ? 'live' : 'snapshot',
    turn: {
      ...describeQueue(queue, currentId),
      userLabels: Object.fromEntries(queue.map((id) => [id, getSocketLabel(id)])),
      target: {
        id: PTZ_CAMERA_ID,
        name: cameraConfig.name || 'PTZ Camera',
        color: cameraConfig.color || DEFAULT_PTZ_COLOR,
        fallback: null,
      },
      enabled: entered && (isOperator || position > 0) && participation.state.queue.length > 0,
      isActive: isOperator,
      turnsAhead: isOperator ? 0 : position || null,
      queueLength: participation.state.queue.length + (participation.state.operatorSocketId ? 1 : 0),
      deadline: participation.state.deadline,
      durationMs: getTurnDurationMs(),
      idleDeadline: null,
      idleGraceMs: 7000,
      labels: turnLabels,
    },
  };
}

function getPublicState(socket = null) {
  return {
    enabled,
    id: PTZ_CAMERA_ID,
    name: cameraConfig.name || 'PTZ Camera',
    color: cameraConfig.color || DEFAULT_PTZ_COLOR,
    initialized: runtime.state.initialized,
    initializing: runtime.state.initializing,
    error: runtime.state.error,
    streamPath: runtime.state.streamPath,
    status: runtime.state.status,
    light: runtime.state.light,
    ir: runtime.state.ir,
    presets: runtime.state.presets,
    presetsError: runtime.state.presetsError,
    publisher: runtime.state.publisher,
    reolinkApi: runtime.state.reolinkApi,
    audio: runtime.getAudioState(),
    ...describeParticipation(socket),
  };
}

function getOperatingModeDisplay(socketId) {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket || !socket.data?.ptzEntered || getOperatingMode(socket) !== 'ptz') return null;
  return {
    name: cameraConfig.name || 'PTZ Camera',
    color: cameraConfig.color || DEFAULT_PTZ_COLOR,
  };
}

function getParticipantSocketIds() {
  // A released/expired camera turn does not end participation in PTZ mode.
  return Array.from(io.sockets.sockets.values())
    .filter((socket) => getOperatingMode(socket) === 'ptz' && Boolean(socket.data?.ptzEntered) && canUsePtzFeature(socket))
    .map((socket) => socket.id);
}

function countControllableUsers() {
  const ids = new Set();
  io.sockets.sockets.forEach((candidate) => {
    if (!candidate?.id || getRole(candidate) === 'spectator') return;
    if (roverManager.getRoversForSocket(candidate.id).length > 0) {
      ids.add(candidate.id);
    }
  });
  getParticipantSocketIds().forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && getRole(socket) !== 'spectator') ids.add(socketId);
  });
  return ids.size;
}

function canSpeakThroughPtz(socket) {
  /*
    PTZ chat carries its own operating-mode identity and camera queue rather
    than a roverManager driver record. Match the rover TTS rule closely: the
    current operator may speak, and queued users may prepare/use TTS while they
    are in the camera queue. canUsePtzFeature keeps the normal VIP/admin/mode
    access gates in front of both cases.
  */
  if (getOperatingMode(socket) !== 'ptz' || !canUsePtzFeature(socket)) return false;
  const socketId = socket?.id ? String(socket.id) : '';
  if (!socketId) return false;
  return participation.state.operatorSocketId === socketId || participation.state.queue.includes(socketId);
}

async function speakText(text, ttsOptions = {}, socket = null) {
  if (!canSpeakThroughPtz(socket)) {
    throw new Error('Only the PTZ operator or queue can use PTZ TTS');
  }
  return runtime.speakText(text, ttsOptions, { socketId: socket?.id || null }, () => {
    if (!canSpeakThroughPtz(socket)) throw new Error('PTZ speech access changed');
  });
}

function checkParticipationAccess(socket) {
  if (!canUsePtzFeature(socket)) throw new Error('Not authorized for PTZ camera');
  if (!runtime.state.initialized) throw new Error(runtime.state.error || 'PTZ camera is not ready');
}

async function prepareParticipation(socket) {
  if (!canUsePtzFeature(socket)) throw new Error('Not authorized for PTZ camera');
  await runtime.initialize();
}

function requireOperator(socket) {
  if (!enabled) throw new Error('PTZ camera disabled');
  if (!canUsePtzFeature(socket)) throw new Error('Not authorized for PTZ camera');
  if (!socket || !socket.data?.ptzEntered || getOperatingMode(socket) !== 'ptz' || participation.state.operatorSocketId !== socket.id) throw new Error('Not the PTZ operator');
}

function requirePtzUser(socket) {
  /*
    Listing presets does not move the camera, but it still reveals operational
    camera state. Check the camera's own enabled switch just like queue entry so
    unverified users cannot query PTZ-only data through raw socket calls.
  */
  if (!enabled) throw new Error('PTZ camera disabled');
  if (!canUsePtzFeature(socket)) throw new Error('Not authorized for PTZ camera');
}

function requirePresetAdmin(socket) {
  /*
    Preset removal is intentionally narrower than normal PTZ operation because
    deleting a shared camera position is destructive for every future operator.
    Creation now uses requirePtzUser instead so any authorized PTZ user can save
    a useful current position without also being allowed to remove presets.
  */
  if (!enabled) throw new Error('PTZ camera disabled');
  if (!canUsePtzFeature(socket)) throw new Error('Not authorized for PTZ camera');
  if (!isAdmin(socket) && !isLockdownAdmin(socket)) throw new Error('PTZ preset admin required');
}

function canRequestLiveVideo(socket) {
  if (!enabled || !passesMode(socket)) return false;
  if (participation.state.operatorSocketId === socket?.id) return canUsePtzFeature(socket);
  if (isAdmin(socket) || isLockdownAdmin(socket)) return true;
  const role = getRole(socket);
  const local = isLocalNetwork(getSocketIp(socket));
  if (role === 'spectator') {
    /*
      Spectator PTZ viewing follows the spectator bandwidth switch. LAN viewers
      stay live because they do not consume server upload; non-local spectators
      only get live PTZ when the external spectator video policy allows it.
    */
    return local || !shouldUseSnapshotsForExternalSpectatorVideo();
  }
  if (
    canUsePtzFeature(socket) &&
    !shouldUseSnapshotsForNonTurnVideo({ controllableUserCount: countControllableUsers() })
  ) {
    /*
      Verified/VIP users who can queue or claim the camera are PTZ "turn"
      participants even before they become operator. When non-turn video is set
      to live, they may watch the live feed while waiting; camera movement still
      remains limited to the active operator by the command handlers.
    */
    return true;
  }
  return false;
}

function normalizeSnapshotIds(payload = {}) {
  /*
    PTZ only has one camera today, but accepting the same { ids } payload shape
    as rover snapshots keeps the browser subscription lifecycle consistent.
    Unknown ids are ignored rather than treated as separate PTZ cameras.
  */
  const rawIds = Array.isArray(payload.ids) ? payload.ids : [payload.id || PTZ_CAMERA_ID];
  const ids = rawIds.map((id) => String(id || '').trim()).filter((id) => id === PTZ_CAMERA_ID);
  return ids.length ? ids : [PTZ_CAMERA_ID];
}

function addSnapshotSubscription(socket, ids = [PTZ_CAMERA_ID]) {
  if (!ids.includes(PTZ_CAMERA_ID)) return;
  if (!snapshotSubscribers.has(PTZ_CAMERA_ID)) snapshotSubscribers.set(PTZ_CAMERA_ID, new Set());
  snapshotSubscribers.get(PTZ_CAMERA_ID).add(socket.id);
  if (!socketSnapshotSubscriptions.has(socket.id)) socketSnapshotSubscriptions.set(socket.id, new Set());
  socketSnapshotSubscriptions.get(socket.id).add(PTZ_CAMERA_ID);
}

function removeSnapshotSubscriptions(socketId, ids = null) {
  const bucket = socketSnapshotSubscriptions.get(socketId);
  if (!bucket) return;
  const idsToRemove = ids ? new Set(ids) : bucket;
  idsToRemove.forEach((id) => {
    const subscribers = snapshotSubscribers.get(id);
    if (subscribers) {
      subscribers.delete(socketId);
      if (!subscribers.size) snapshotSubscribers.delete(id);
    }
    bucket.delete(id);
  });
  if (!bucket.size) {
    socketSnapshotSubscriptions.delete(socketId);
    snapshotLastSentBySocket.delete(socketId);
  }
}

function sendSnapshotFrame(socket, buffer, ts) {
  socket.emit('ptzCamera:snapshotFrame', { id: PTZ_CAMERA_ID, ts }, buffer);
}

function normalizeSocketArgs(firstArg, secondArg) {
  /*
    Socket.IO does not reserve a payload slot. If the browser emits only an ack
    callback, the callback arrives as the first argument; if it emits no ack,
    there is no callback at all. PTZ movement is sometimes fire-and-forget from
    the shared rover control pipeline, so every handler needs the same small
    normalizer before it calls back.
  */
  if (typeof firstArg === 'function') {
    return { payload: {}, cb: firstArg };
  }
  return {
    payload: firstArg && typeof firstArg === 'object' ? firstArg : {},
    cb: typeof secondArg === 'function' ? secondArg : () => {},
  };
}

function claimTurn(socket) {
  checkParticipationAccess(socket);
  participation.claim(socket);
  return getPublicState(socket);
}
function releaseTurn(socket) {
  participation.release(socket.id);
  return getPublicState(socket);
}
function acceptMotionIntent(socket, payload) {
  requireOperator(socket);
  return runtime.queueMotionIntent(payload, 'operator-input');
}
function operatorAction(method, socket, payload) {
  requireOperator(socket);
  const turn = participation.state.generation;
  return runtime[method](payload, () => {
    requireOperator(socket);
    if (participation.state.generation !== turn) throw new Error('PTZ turn changed');
  });
}
function presetAction(method, socket, payload) {
  const authorize = () => method === 'removePreset' ? requirePresetAdmin(socket) : requirePtzUser(socket);
  authorize();
  return runtime[method](payload, authorize);
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


function reconcileAccess() {
  participation.reconcile();
  videoSessions.revokeWhere((info) => info.sourceType === 'ptz'
    && !canRequestLiveVideo(io.sockets.sockets.get(info.socketId)));
  for (const socketId of socketSnapshotSubscriptions.keys()) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket || !passesMode(socket)) removeSnapshotSubscriptions(socketId);
  }
}
modeEvents.on('change', reconcileAccess);
roleEvents.on('change', reconcileAccess);
verificationEvents.on('change', reconcileAccess);

registerSocketGateway({
  io, isAdmin, participation, emitChange, normalizeSocketArgs, runPtzTurnAction,
  acceptMotionIntent, passesMode, normalizeSnapshotIds, addSnapshotSubscription,
  sendSnapshotFrame, removeSnapshotSubscriptions, getSnapshot: () => runtime.getSnapshot(),
  getStatus: (socket) => { requirePtzUser(socket); return runtime.getStatus(); },
  listPresets: (socket) => { requirePtzUser(socket); return runtime.listPresets(); },
  gotoPreset: (socket, payload) => operatorAction('gotoPreset', socket, payload),
  setSpotlight: (socket, payload) => operatorAction('setSpotlight', socket, payload),
  setIr: (socket, payload) => operatorAction('setIr', socket, payload),
  createPreset: (socket, payload) => presetAction('createPreset', socket, payload),
  removePreset: (socket, payload) => presetAction('removePreset', socket, payload),
});
function startRuntime() {
  if (enabled) runtime.initialize().catch((err) => logger.warn('PTZ initialization failed', { error: err.message }));
}
registerConfigurationHandler('ptzCamera', (nextCameraConfig = {}) => {
  participation.clear('configuration-change');
  const startAfter = runtime.stop();
  cameraConfig = nextCameraConfig;
  enabled = Boolean(cameraConfig.enabled);
  runtime = createCameraRuntime({ cameraConfig, logger, events, onChange: emitChange, getSocketLabel, startAfter });
  reconcileAccess();
  startRuntime();
});
startRuntime();

module.exports = {
  PTZ_CAMERA_ID,
  PTZ_STREAM_PATH,
  ptzCameraEvents: events,
  getPublicState,
  getOperatingModeDisplay,
  prepareParticipation,
  checkParticipationAccess,
  claimTurn,
  releaseTurn,
  getParticipantSocketIds,
  canSpeakThroughPtz,
  speakText,
  canRequestLiveVideo,
  disableEmittersForIdle: () => runtime.disableEmittersForIdle(),
  getReplaySource: () => enabled && isReplayEnabled()
    ? { type: 'ptz', id: PTZ_CAMERA_ID, label: cameraConfig.name || 'PTZ Camera' }
    : null,
  getReplayWorkerSources: () => {
    /*
      PTZ replay uses two internal workers from the same MediaMTX path. The
      selectable replay source stays "ptz:ptz-camera", while the segment engine
      records video and audio separately so replayBuilder can mix PTZ microphone
      audio the same way it already mixes rover audio.
    */
    if (!enabled || !isReplayEnabled()) return [];
    const inputUrl = `rtsp://127.0.0.1:8554/${encodeURIComponent(PTZ_STREAM_PATH)}`;
    const label = cameraConfig.name || 'PTZ Camera';
    return [
      {
        id: PTZ_CAMERA_ID,
        sourceType: 'ptz',
        kind: 'video',
        label,
        inputUrl,
      },
      {
        id: `${PTZ_CAMERA_ID}-audio`,
        sourceType: 'ptz',
        sourceId: PTZ_CAMERA_ID,
        kind: 'audio',
        label: `${label} audio`,
        inputUrl,
      },
    ];
  },
  getReplayWorkerSource: () => {
    const [videoSource] = module.exports.getReplayWorkerSources();
    return videoSource || null;
  },
};
