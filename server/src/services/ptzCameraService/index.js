// PTZ Camera Service
// Purpose: Owns the single Reolink TrackMix PTZ camera integration, including queueing, ONVIF control, Reolink-only light controls, stream publishing, snapshots, and session state.
// Scope: This is intentionally a one-camera feature, not a generic ONVIF camera framework.
const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { Cam } = require('onvif');

const io = require('../../globals/io');
const logger = require('../../globals/logger').child('ptzCamera');
const { loadConfig } = require('../../helpers/configLoader');
const { isFeatureEnabled } = require('../../helpers/features');
const {
  shouldUseSnapshotsForNonTurnVideo,
  shouldUseSnapshotsForExternalSpectatorVideo,
} = require('../../helpers/bandwidthSavings');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('../roleService');
const { isVerified } = require('../verificationService');
const { getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');
const roverManager = require('../roverManager');
const assignmentService = require('../assignmentService');
const videoSessions = require('../videoSessions');
const { createPtzAudioPlayback } = require('./audioPlayback');

const PTZ_CAMERA_ID = 'ptz-camera';
const PTZ_STREAM_PATH = 'ptz-camera';
const DEFAULT_ONVIF_PORT = 8000;
const DEFAULT_PROFILE_TOKEN = '003';
const DEFAULT_TURN_DURATION_MS = 5 * 60 * 1000;
// PTZ is a normal replay source now, so capture should be on unless the feature
// explicitly disables replay for the camera.
const DEFAULT_REPLAY_ENABLED = true;
const DEFAULT_PTZ_COLOR = '#387bf8';
const SNAPSHOT_DIR = process.env.ROVER_SNAPSHOT_DIR || '/var/lib/rover-snapshots';
const SNAPSHOT_POLL_MS = 300;
const SNAPSHOT_STREAM_INTERVAL_MS = 2000;
const SPOTLIGHT_VERIFY_DELAY_MS = 1200;
const PUBLISHER_STDERR_SYNC_MS = 10000;
const PUBLISHER_RTSP_TIMEOUT_US = 10000000;

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
  presets: [],
  presetsError: null,
  publisher: {
    running: false,
    pid: null,
    startedAt: null,
    restartAt: null,
    restartCount: 0,
    exitCode: null,
    exitSignal: null,
    exitedAt: null,
    lastStderr: '',
    progress: null,
    lastEvent: 'idle',
  },
  reolinkApi: {
    connected: false,
    connecting: false,
    lastError: null,
    lastConnectedAt: null,
    lastEvent: 'idle',
  },
};

let onvifCam = null;
let reolinkModulePromise = null;
let turnTimer = null;
let publisherProcess = null;
let publisherRestartTimer = null;
let publisherStderrSyncTimer = null;
let snapshotTimer = null;
let spotlightVerifyTimer = null;
let vendorStatePromise = Promise.resolve();
let lastSnapshotState = null;
const snapshotSubscribers = new Map();
const socketSnapshotSubscriptions = new Map();
const snapshotLastSentBySocket = new Map();
const audioPlayback = createPtzAudioPlayback({
  logger,
  cameraConfig,
  enabled,
  getSocketLabel,
});

function emitChange(reason = 'change') {
  events.emit('change', { reason, state: getPublicState() });
}

function schedulePublisherStateSync(reason = 'publisher') {
  /*
    ffmpeg can print many warning/progress lines in bursts. Keep the latest text
    in state immediately, but debounce session sync so one noisy transcoder does
    not force every connected client to resync for each stderr chunk.
  */
  if (publisherStderrSyncTimer) return;
  publisherStderrSyncTimer = setTimeout(() => {
    publisherStderrSyncTimer = null;
    emitChange(reason);
  }, PUBLISHER_STDERR_SYNC_MS);
}

function updatePublisherState(patch = {}, reason = 'publisher') {
  state.publisher = {
    ...(state.publisher || {}),
    ...patch,
  };
  emitChange(reason);
}

function updateReolinkApiState(patch = {}, reason = 'reolink-api') {
  state.reolinkApi = {
    ...(state.reolinkApi || {}),
    ...patch,
  };
  emitChange(reason);
}

function parsePublisherProgressLine(line) {
  /*
    ffmpeg's "-progress pipe:2" emits simple key=value telemetry on stderr.
    Warning lines also arrive on stderr, so keep parsing narrow: only accept the
    known progress keys and let everything else remain user-visible stderr.
    This gives the UI enough signal to tell whether the transcoder is actually
    falling behind without flooding normal server logs.
  */
  const match = String(line || '').match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
  if (!match) return false;
  const [, key, rawValue] = match;
  const allowed = new Set([
    'frame',
    'fps',
    'stream_0_0_q',
    'bitrate',
    'total_size',
    'out_time_us',
    'out_time_ms',
    'out_time',
    'dup_frames',
    'drop_frames',
    'speed',
    'progress',
  ]);
  if (!allowed.has(key)) return false;
  state.publisher = {
    ...(state.publisher || {}),
    progress: {
      ...(state.publisher?.progress || {}),
      [key]: rawValue,
      updatedAt: Date.now(),
    },
    lastEvent: 'progress',
  };
  return true;
}

function handlePublisherStderr(chunk) {
  const text = String(chunk || '').trim();
  if (!text) return;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const warningLines = [];

  lines.forEach((line) => {
    if (!parsePublisherProgressLine(line)) warningLines.push(line);
  });

  if (warningLines.length) {
    state.publisher = {
      ...(state.publisher || {}),
      lastStderr: warningLines.join('\n').slice(-1000),
      lastEvent: 'stderr',
    };
  }

  schedulePublisherStateSync(warningLines.length ? 'publisher-stderr' : 'publisher-progress');
}

function clampUnit(value) {
  const number = Number(value) || 0;
  return Math.max(-1, Math.min(1, number));
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

function spotlightCameraStateForLogicalOn(logicalOn) {
  return Boolean(logicalOn) ? 1 : 0;
}

function isSpotlightOn(light = {}) {
  const raw = light?.state;
  let rawOn = false;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    rawOn = !['', '0', 'off', 'false'].includes(normalized);
  } else {
    rawOn = Boolean(Number(raw));
  }
  return rawOn;
}

function normalizeSpotlightState(light) {
  if (!light || typeof light !== 'object') return light || null;
  return { ...light, on: isSpotlightOn(light) };
}

function normalizeSpotlightPayloadState(rawState) {
  /*
    Socket payloads can arrive as booleans, numbers, or strings depending on
    which control path produced them. Boolean("0") is true in JavaScript, so do
    an explicit conversion here before building the Reolink payload.
  */
  if (typeof rawState === 'string') {
    const normalized = rawState.trim().toLowerCase();
    if (['1', 'on', 'true', 'yes'].includes(normalized)) return true;
    if (['0', 'off', 'false', 'no'].includes(normalized)) return false;
  }
  return Boolean(Number(rawState));
}

function normalizeIrState(rawState) {
  /*
    Reolink accepts exactly Auto, On, and Off for this camera's IR LED control.
    Normalize UI payloads at the server boundary so keyboard, mobile, and any
    future direct socket callers all hit the same camera API contract.
  */
  const normalized = String(rawState || '').trim().toLowerCase();
  if (normalized === 'on' || normalized === '1' || normalized === 'true') return 'On';
  if (normalized === 'off' || normalized === '0' || normalized === 'false') return 'Off';
  return 'Auto';
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
    color: cameraConfig.color || DEFAULT_PTZ_COLOR,
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
    presets: state.presets,
    presetsError: state.presetsError,
    publisher: state.publisher,
    reolinkApi: state.reolinkApi,
    audio: audioPlayback.getState(),
    isOperator: Boolean(socketId && state.operatorSocketId === socketId),
    queuedPosition: socketId ? state.queue.indexOf(socketId) + 1 || null : null,
    canUse: socket ? canUsePtzFeature(socket) : false,
  };
}

function getChatTargetForSocket(socketId) {
  /*
    Chat badges are rendered through the same rover badge component on the
    browser, so PTZ presents itself as a rover-like chat target while a user is
    actively operating or waiting for the camera. Keeping this mapping in the
    PTZ service avoids making chat infer camera queue details from public state.
  */
  if (!enabled || !socketId) return null;
  const normalized = String(socketId);
  const waiting = state.queue.includes(normalized);
  const operating = state.operatorSocketId === normalized;
  if (!waiting && !operating) return null;
  return {
    roverId: PTZ_CAMERA_ID,
    roverName: cameraConfig.name || 'PTZ Camera',
    roverColor: cameraConfig.color || DEFAULT_PTZ_COLOR,
  };
}

function getParticipantSocketIds() {
  /*
    PTZ has no roverManager record, so services that need a global "how many
    controllable users are online" count need a tiny PTZ-owned participant list.
    The operator and queue are the only users attached to this controllable
    camera target; spectators merely viewing snapshots/live video are excluded.
  */
  return Array.from(new Set([
    state.operatorSocketId,
    ...state.queue,
  ].filter(Boolean)));
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
    PTZ chat uses roverId for identity, but the camera has its own queue rather
    than a roverManager driver record. Match the rover TTS rule closely: the
    current operator may speak, and queued users may prepare/use TTS while they
    are in the camera queue. canUsePtzFeature keeps the normal VIP/admin/mode
    access gates in front of both cases.
  */
  if (!canUsePtzFeature(socket)) return false;
  const socketId = socket?.id ? String(socket.id) : '';
  if (!socketId) return false;
  return state.operatorSocketId === socketId || state.queue.includes(socketId);
}

async function speakText(text, ttsOptions = {}, socket = null) {
  if (!canSpeakThroughPtz(socket)) {
    throw new Error('Only the PTZ operator or queue can use PTZ TTS');
  }
  return audioPlayback.speakText(text, ttsOptions, { socketId: socket?.id || null });
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

function normalizePresetName(rawName, token) {
  /*
    ONVIF cameras are inconsistent about preset names. Some return a readable
    Name field, some return name, and some only return the token. The browser
    needs a stable label for every button, so fall back to the token only after
    exhausting the human-facing fields the camera may provide.
  */
  const name = String(rawName || '').trim();
  if (name) return name;
  const tokenLabel = String(token || '').trim();
  return tokenLabel ? `Preset ${tokenLabel}` : 'Unnamed preset';
}

function normalizeOnvifPreset(entry, fallbackToken = '') {
  /*
    The onvif package returns camera XML converted to plain objects, but exact
    key casing can vary by device and service response. Normalize once at the
    service boundary so UI and socket callers never depend on vendor-specific
    field names.
  */
  if (!entry || typeof entry !== 'object') return null;
  const token = String(entry.token || entry.$?.token || entry.presetToken || entry.PresetToken || fallbackToken || '').trim();
  if (!token) return null;
  return {
    token,
    name: normalizePresetName(entry.name || entry.Name, token),
  };
}

function normalizeOnvifPresets(raw) {
  /*
    getPresets can come back as an array directly, as { presets }, or as nested
    ONVIF response data depending on the library/device pairing. Keep this
    intentionally permissive because a missing preset list should degrade to an
    empty panel, not a broken PTZ session.
  */
  const candidates = Array.isArray(raw)
    ? raw.map((entry) => [null, entry])
    : Array.isArray(raw?.presets)
    ? raw.presets.map((entry) => [null, entry])
    : Array.isArray(raw?.Presets)
    ? raw.Presets.map((entry) => [null, entry])
    : Array.isArray(raw?.GetPresetsResponse?.Preset)
    ? raw.GetPresetsResponse.Preset.map((entry) => [null, entry])
    : Array.isArray(raw?.Preset)
    ? raw.Preset.map((entry) => [null, entry])
    : raw && typeof raw === 'object'
    ? Object.entries(raw)
    : [];
  return candidates
    .map(([fallbackToken, entry]) => normalizeOnvifPreset(entry, fallbackToken))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

async function refreshPresets(reason = 'presets') {
  /*
    The camera owns preset storage. Reading it back after every create/delete
    keeps this server stateless and avoids a local JSON store drifting away from
    what ONVIF will actually accept for gotoPreset.
  */
  await initialize();
  try {
    const raw = await callOnvif('getPresets', { profileToken: state.profileToken });
    state.presets = normalizeOnvifPresets(raw);
    state.presetsError = null;
  } catch (err) {
    state.presets = [];
    state.presetsError = err.message || String(err);
    logger.warn('Failed to refresh PTZ presets', { error: state.presetsError });
  }
  emitChange(reason);
  return state.presets;
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
  updatePublisherState({
    running: false,
    pid: null,
    restartAt: null,
    lastEvent: 'stopped',
  }, 'publisher-stop');
}

function schedulePublisherRestart(reason = 'publisher-restart') {
  /*
    The publisher's recovery rule is intentionally simple: ffmpeg owns the RTSP
    connection, and this service starts a fresh process whenever that connection
    causes ffmpeg to exit. Clearing any existing timer first prevents a burst of
    quick exits from scheduling multiple competing replacement publishers.
  */
  if (!enabled || !state.rtspUri) return null;
  if (publisherRestartTimer) {
    clearTimeout(publisherRestartTimer);
    publisherRestartTimer = null;
  }
  const restartAt = Date.now() + 1500;
  publisherRestartTimer = setTimeout(() => {
    publisherRestartTimer = null;
    startPublisher();
  }, 1500);
  updatePublisherState({
    restartAt,
    restartCount: Number(state.publisher?.restartCount || 0) + 1,
    lastEvent: reason,
  }, 'publisher-restart-scheduled');
  return restartAt;
}

function startPublisher() {
  if (!enabled || !state.rtspUri || publisherProcess) return;
  const input = addCredentialsToRtsp(state.rtspUri);
  const output = `srt://127.0.0.1:9000?streamid=publish:${encodeURIComponent(PTZ_STREAM_PATH)}`;
  /*
    The full-quality autotrack profile is H265, which is the right camera-side
    feed but has been unreliable through browser WHEP playback. Re-encoding is
    intentionally kept here, at the single camera publisher boundary, so the
    rest of the video auth/session/UI code still sees one normal MediaMTX path.

    The camera audio is AAC LC at 16 kHz mono. Keep it inline with the video so
    the PTZ camera remains one MediaMTX/WHEP source, but transcode it to Opus
    because that is the WebRTC-friendly audio codec browsers should negotiate
    through MediaMTX. This avoids creating a rover-style separate audio stream
    for a camera that already provides synchronized audio in the RTSP feed.

    These encoder settings trade compression efficiency for control latency:
    ultrafast avoids deep analysis, zerolatency disables x264 buffering, bf=0
    removes B-frames, and the 20-frame GOP matches the camera's observed 20fps
    autotrack stream so the browser gets frequent keyframes without forcing a
    huge bitrate spike. The explicit x264 params turn off lookahead buffering
    that is useful for compression quality but harmful when the camera is being
    driven live. Sliced threads allow x264 to keep some parallelism without
    waiting on future frames the way normal frame-threading can.

    Keep RTSP demuxing conservative here. More aggressive "drop stale frames"
    flags caused this camera stream to freeze after running for a while, so the
    safer latency knob is to keep the encoder light and avoid building delay
    inside x264 itself.

    The camera can restart while ffmpeg keeps its old TCP/RTSP session open and
    continues publishing a useless black output stream. The timeout options are
    input-side failure detectors: when the RTSP socket stops producing usable
    reads for long enough, ffmpeg should exit instead of staying attached to the
    dead session. The existing exit handler then starts a new process, which is
    the part that creates a fresh RTSP connection after the camera comes back.

    The mpegts muxer can also hold packets briefly before writing them to SRT.
    flush_packets/muxdelay/muxpreload are output-side latency knobs; they do not
    ask the camera or demuxer to discard frames, so they are a safer next step
    than the stale-frame dropping experiments that made the Reolink feed freeze.
  */
  const proc = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostdin',
    '-progress',
    'pipe:2',
    '-stats_period',
    '2',
    '-fflags',
    'nobuffer',
    '-flags',
    'low_delay',
    '-rtsp_transport',
    'tcp',
    '-timeout',
    String(PUBLISHER_RTSP_TIMEOUT_US),
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-threads',
    '8',
    '-x264-params',
    'sliced-threads=1:sync-lookahead=0:rc-lookahead=0:keyint=20:min-keyint=20:scenecut=0',
    '-bf',
    '0',
    '-g',
    '20',
    '-keyint_min',
    '20',
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'libopus',
    '-application',
    'lowdelay',
    '-frame_duration',
    '10',
    '-b:a',
    '32k',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-strict',
    '-2',
    '-flush_packets',
    '1',
    '-muxdelay',
    '0',
    '-muxpreload',
    '0',
    '-f',
    'mpegts',
    output,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  publisherProcess = proc;
  updatePublisherState({
    running: true,
    pid: proc.pid || null,
    startedAt: Date.now(),
    restartAt: null,
    exitCode: null,
    exitSignal: null,
    exitedAt: null,
    lastEvent: 'started',
  }, 'publisher-start');
  proc.stderr.on('data', handlePublisherStderr);
  proc.on('exit', (code, signal) => {
    if (publisherProcess === proc) publisherProcess = null;
    logger.warn('publisher exited', { code, signal, lastStderr: state.publisher?.lastStderr || null });
    const restartAt = enabled && state.rtspUri ? Date.now() + 1500 : null;
    updatePublisherState({
      running: false,
      pid: null,
      restartAt,
      exitCode: code,
      exitSignal: signal,
      exitedAt: Date.now(),
      lastEvent: restartAt ? 'restarting' : 'exited',
    }, 'publisher-exit');
    if (restartAt) schedulePublisherRestart('restarting');
  });
  logger.info('Started PTZ stream publisher', { streamPath: PTZ_STREAM_PATH, encoder: 'libx264' });
}

function getErrorMessage(err) {
  return err?.message || String(err || 'unknown error');
}

async function closeReolinkClient(client, reason = 'reset') {
  /*
    Each Reolink operation owns a short-lived long-mode session. close() logs
    out and frees any SDK resources; cleanup failures are logged at debug level
    because the command result has already been determined by the time finally
    cleanup runs.
  */
  if (!client || typeof client.close !== 'function') return;
  try {
    await client.close();
  } catch (err) {
    logger.debug?.('Reolink client close failed', { reason, error: getErrorMessage(err) });
  }
}

async function createReolinkClientSession() {
  /*
    reolink-nvr-api is published as an ESM-only package. This server is still
    CommonJS, so a top-level require() fails before the service can even start.
    Dynamic import keeps the server bootable while still creating a fresh camera
    API client for every command. Avoiding a cached long-lived client keeps one
    wedged Reolink session from poisoning later light/IR commands.
  */
  if (!reolinkModulePromise) {
    reolinkModulePromise = import('reolink-nvr-api');
  }
  const { ReolinkClient } = await reolinkModulePromise;
  const client = new ReolinkClient({
    host: cameraConfig.host,
    username: cameraConfig.username,
    password: cameraConfig.password,
    mode: 'long',
    insecure: true,
    timeout: 10000,
  });
  await client.login();
  updateReolinkApiState({
    connected: true,
    connecting: false,
    lastError: null,
    lastConnectedAt: Date.now(),
    lastEvent: 'connected',
  }, 'reolink-api-connected');
  return client;
}

async function callReolinkApi(command, payload = {}) {
  /*
    Commands should not depend on the previous command's session or observed
    state. Open a fresh Reolink session, send exactly the requested API command,
    and close it. If the camera rejects or ignores the command, the failure is
    allowed to surface to the caller instead of being hidden behind retries that
    can make the UI look successful while the physical emitter never changed.
  */
  if (!enabled) throw new Error('PTZ camera disabled');
  updateReolinkApiState({
    connected: false,
    connecting: true,
    lastEvent: 'connecting',
  }, 'reolink-api-connecting');
  let client = null;
  try {
    client = await createReolinkClientSession();
    const result = await client.api(command, payload);
    updateReolinkApiState({
      connected: false,
      connecting: false,
      lastError: null,
      lastConnectedAt: Date.now(),
      lastEvent: 'api-ok-closed',
    }, 'reolink-api-ok');
    return result;
  } catch (err) {
    const message = getErrorMessage(err);
    updateReolinkApiState({
      connected: false,
      connecting: false,
      lastError: message,
      lastEvent: 'api-error',
    }, 'reolink-api-error');
    logger.warn('Reolink API command failed', { command, error: message });
    throw err;
  } finally {
    await closeReolinkClient(client, `api:${command}`);
  }
}

async function refreshVendorState() {
  if (!enabled) return;
  /*
    Read these sequentially so the camera sees one fresh-session API request at
    a time. Parallel reads are not useful here, and avoiding overlap keeps the
    vendor API behavior easier to reason about when it is already acting flaky.
  */
  const white = await callReolinkApi('GetWhiteLed', { channel: 0 });
  const ir = await callReolinkApi('GetIrLights', { channel: 0 });
  state.light = normalizeSpotlightState(white?.WhiteLed || white || null);
  state.ir = ir?.IrLights || ir || null;
}

async function refreshSpotlightState() {
  const white = await callReolinkApi('GetWhiteLed', { channel: 0 });
  state.light = normalizeSpotlightState(white?.WhiteLed || white || null);
  emitChange('light');
  return state.light;
}

function scheduleSpotlightVerification() {
  /*
    This camera acknowledges SetWhiteLed before GetWhiteLed catches up. A read
    immediately after a successful write returns the old value for roughly one
    second, which made the UI appear inverted or flaky. Replace any pending
    verification with one delayed read so rapid toggles settle on the newest
    requested state instead of racing stale camera state back into the session.
  */
  if (spotlightVerifyTimer) {
    clearTimeout(spotlightVerifyTimer);
    spotlightVerifyTimer = null;
  }
  spotlightVerifyTimer = setTimeout(() => {
    spotlightVerifyTimer = null;
    serializeVendorState(() => refreshSpotlightState()).catch((err) => {
      logger.warn('spotlight verification failed', { error: err.message });
    });
  }, SPOTLIGHT_VERIFY_DELAY_MS);
}

function serializeVendorState(operation) {
  /*
    The Reolink HTTP API can return stale light state when reads and writes are
    overlapped. Keep spotlight/IR changes in one narrow queue so a button mash
    becomes ordered camera operations instead of competing Get/Set requests.
  */
  vendorStatePromise = vendorStatePromise
    .catch(() => {})
    .then(operation);
  return vendorStatePromise;
}

async function initialize() {
  if (!enabled || state.initialized || state.initializing) return;
  state.initializing = true;
  try {
    onvifCam = await connectOnvif();
    state.rtspUri = await getStreamUriForProfile(onvifCam);
    /*
      Reolink light/IR state is useful, but it must not block PTZ startup. The
      vendor API can be unavailable while ONVIF and RTSP are already healthy;
      awaiting this refresh here would keep the publisher and queue disabled
      until the HTTP API responds. Queue it instead so video startup continues.
    */
    serializeVendorState(() => refreshVendorState()).catch((err) => {
      logger.warn('initial Reolink state refresh failed', { error: getErrorMessage(err) });
    });
    /*
      Presets are not required for the camera to be usable. Refresh them during
      startup so connected clients have the list immediately, but keep failures
      isolated inside refreshPresets() so a camera with broken preset support
      can still pan, tilt, zoom, and stream normally.
    */
    await refreshPresets('initialize-presets');
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

function removeFromQueue(socketId) {
  state.queue = state.queue.filter((id) => id !== socketId);
}

function buildDockRequiredPayload(socket, leave) {
  /*
    PTZ must not become an escape hatch for abandoning the last undocked rover.
    Keep the payload shape shared between immediate claim rejection and stale
    queue cleanup so the browser gets one consistent dock-required event.
  */
  return {
    socketId: socket.id,
    label: getSocketLabel(socket.id),
    roverId: leave.currentId || null,
    message: leave.message,
    until: null,
  };
}

function releaseRoverOwnershipForPtz(socket) {
  /*
    PTZ operation must remove the browser from every rover-control state, not
    only the roverManager driver set. The normal assignment UI is backed by
    assignmentService, while low-level control membership is tracked inside
    roverManager. In healthy flows those two agree, but reconnects, admin paths,
    or earlier cleanup can leave only one side populated. Releasing the union
    keeps PTZ from looking like a second simultaneous rover assignment.
  */
  if (!socket?.id) return;
  const roverIds = new Set(roverManager.getRoversForSocket(socket.id));
  const assignedRoverId = assignmentService.getAssignedRover?.(socket.id);
  if (assignedRoverId) roverIds.add(assignedRoverId);
  roverIds.forEach((roverId) => {
    assignmentService.forceRelease(roverId, socket.id);
  });
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
  state.operatorSocketId = socket.id;
  state.deadline = Date.now() + getTurnDurationMs();
  turnTimer = setTimeout(handleTurnDeadline, getTurnDurationMs());
  socket.emit('ptzCamera:turn', { status: 'active', deadline: state.deadline });
  events.emit('operator', { socketId: socket.id, action: 'active' });
  emitChange('operator-active');
}

function handleTurnDeadline() {
  turnTimer = null;
  if (!state.operatorSocketId) return;
  if (state.queue.length > 0) {
    revokeOperator('turn-expired');
    advanceQueue('turn-expired');
    return;
  }
  /*
    A turn timer only matters when somebody else is waiting. If the operator is
    alone, keep them on the PTZ camera and roll the deadline forward so the UI
    stays coherent without kicking out the only active viewer.
  */
  state.deadline = Date.now() + getTurnDurationMs();
  turnTimer = setTimeout(handleTurnDeadline, getTurnDurationMs());
  emitChange('turn-extended-empty-queue');
}

function advanceQueue(reason = 'advance') {
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
      claim() blocks this before queue entry, but this defensive check handles
      stale state: a user can dock, join the queue, then undock again before
      their PTZ turn arrives. In that case they are removed instead of holding a
      PTZ queue slot while still responsible for an undocked rover.
    */
    removeFromQueue(socket.id);
    socket.emit('ptzCamera:dockRequired', buildDockRequiredPayload(socket, leave));
    emitChange('drop-dock-required');
    advanceQueue('drop-dock-required');
    return;
  }
  activateOperator(socket);
}

async function claim(socket) {
  if (!canUsePtzFeature(socket)) throw new Error('Not authorized for PTZ camera');
  await initialize();
  if (!state.initialized) throw new Error(state.error || 'PTZ camera is not ready');
  if (state.operatorSocketId === socket.id) return getPublicState(socket);
  const leave = roverManager.canLeaveCurrentRover(socket);
  if (!leave.ok) {
    const payload = buildDockRequiredPayload(socket, leave);
    socket.emit('ptzCamera:dockRequired', payload);
    throw new Error(leave.message);
  }
  /*
    Joining PTZ is the point where rover ownership must end, even when another
    user is currently operating the camera and this socket only enters the
    waiting queue. PTZ queue membership is still a camera session: the user is
    waiting for a camera turn, not continuing as a rover driver until their turn
    arrives. Releasing here also keeps chat badges, assignment UI, and command
    routing from presenting a "rover plus camera queue" hybrid state.
  */
  releaseRoverOwnershipForPtz(socket);
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

function requirePtzUser(socket) {
  /*
    Listing presets does not move the camera, but it still reveals operational
    camera state. Use the same feature gate as queue entry so unverified users
    cannot query PTZ-only data through raw socket calls.
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
  if (!passesMode(socket)) throw new Error('Not authorized for PTZ camera');
  if (!isAdmin(socket) && !isLockdownAdmin(socket)) throw new Error('PTZ preset admin required');
}

function normalizePresetToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) throw new Error('Preset token is required');
  if (/[<>&'"]/.test(token)) throw new Error('Preset token contains invalid characters');
  return token;
}

function escapeOnvifXmlText(value) {
  /*
    The installed onvif package writes option values directly into SOAP XML.
    Escape admin-entered preset names before handing them to the package so a
    normal label like "Door & window" remains valid XML instead of corrupting
    the SetPreset request body.
  */
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizePresetCreateName(rawName) {
  /*
    The ONVIF API stores the preset at the camera's current position. A clear
    name is the only context future users get in the UI, so require a small
    non-empty label instead of silently creating "undefined" camera presets.
  */
  const name = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Preset name is required');
  if (name.length > 60) throw new Error('Preset name must be 60 characters or less');
  return name;
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

async function listPresets(socket) {
  requirePtzUser(socket);
  return refreshPresets('presets-list');
}

async function gotoPreset(socket, payload = {}) {
  requireOperator(socket);
  await initialize();
  const presetToken = normalizePresetToken(payload.token || payload.presetToken);
  /*
    Stop any continuous move before jumping to a preset. Without this, a held
    key or touch control can keep sending pan/tilt velocity while the camera is
    trying to execute the absolute preset move, which makes the final position
    feel inconsistent.
  */
  await callOnvif('stop', { profileToken: state.profileToken, panTilt: true, zoom: true }).catch(() => {});
  await callOnvif('gotoPreset', {
    profileToken: state.profileToken,
    /*
      This onvif package names the goto option "preset" even though it writes
      that value into the ONVIF PresetToken XML element. Keep the local variable
      named presetToken because that is what the camera and UI are actually
      handling, but send the package's expected option name here.
    */
    preset: presetToken,
  });
  return { ok: true, presetToken };
}

async function createPreset(socket, payload = {}) {
  requirePtzUser(socket);
  await initialize();
  const presetName = normalizePresetCreateName(payload.name || payload.presetName);
  const options = {
    profileToken: state.profileToken,
    presetName: escapeOnvifXmlText(presetName),
  };
  /*
    ONVIF setPreset updates an existing token when one is supplied and creates a
    new preset when it is omitted. Support both so the UI can start simple with
    "create current position" and later reuse the same server action for rename
    or overwrite workflows if needed.
  */
  const rawPresetToken = String(payload.token || payload.presetToken || '').trim();
  const presetToken = rawPresetToken ? normalizePresetToken(rawPresetToken) : '';
  if (presetToken) options.presetToken = presetToken;
  const result = await callOnvif('setPreset', options);
  const presets = await refreshPresets('preset-create');
  return {
    ok: true,
    presetToken: result?.presetToken || result?.PresetToken || presetToken || null,
    presets,
  };
}

async function removePreset(socket, payload = {}) {
  requirePresetAdmin(socket);
  await initialize();
  const presetToken = normalizePresetToken(payload.token || payload.presetToken);
  await callOnvif('removePreset', {
    profileToken: state.profileToken,
    presetToken,
  });
  return {
    ok: true,
    presetToken,
    presets: await refreshPresets('preset-remove'),
  };
}

async function setSpotlight(socket, payload = {}) {
  requireOperator(socket);
  return serializeVendorState(async () => {
    let current = state.light ? normalizeSpotlightState(state.light) : null;
    if (payload.state === undefined && !current) {
      /*
        Toggle requests need a base state. Normal button paths send an explicit
        state, so this read only happens for rare generic toggle callers or
        startup races before the initial vendor state has arrived.
      */
      current = await refreshSpotlightState();
    }
    const logicalOn = payload.state === undefined
      ? !isSpotlightOn(current || {})
      : normalizeSpotlightPayloadState(payload.state);
    const cameraState = spotlightCameraStateForLogicalOn(logicalOn);
    const cameraPayload = {
      channel: 0,
      state: cameraState,
    };
    const next = {
      ...(current || {}),
      ...cameraPayload,
      on: logicalOn,
    };
    if (Number.isFinite(Number(payload.bright))) {
      const bright = Math.max(0, Math.min(100, Number(payload.bright)));
      cameraPayload.bright = bright;
      next.bright = bright;
    }
    /*
      Send the explicit requested state through a fresh API session before
      changing public state. If the camera/API rejects the command, the UI should
      not be left showing an optimistic state that never reached the device.
    */
    await callReolinkApi('SetWhiteLed', { WhiteLed: cameraPayload });
    state.light = next;
    emitChange('light');
    scheduleSpotlightVerification();
    return state.light;
  });
}

async function setIr(socket, payload = {}) {
  requireOperator(socket);
  return serializeVendorState(async () => {
    const nextState = normalizeIrState(payload.state);
    /*
      The camera requires channel inside IrLights. Without it, SetIrLights
      returns param error (-4), while the optimistic local state makes the UI
      look like the command worked. Keep the optimistic state, but send the
      minimal payload the camera actually accepts.
    */
    const next = { ...(state.ir || {}), channel: 0, state: nextState };
    /*
      As with spotlight, update session state after the fresh-session command
      succeeds so a rejected Reolink request does not make the UI claim the IR
      mode changed when the camera never accepted it.
    */
    await callReolinkApi('SetIrLights', { IrLights: { channel: 0, state: nextState } });
    state.ir = next;
    emitChange('ir');
    await refreshVendorState();
    return state.ir;
  });
}

async function disableEmittersForIdle() {
  /*
    Idle cleanup is a server-owned safety action, not a user control action, so
    it intentionally does not go through requireOperator(). If nobody is using
    the camera, the system still needs a way to leave every camera-side emitter
    in a known off state.
  */
  if (!enabled) {
    return { action: 'disablePtzEmitters', skipped: true, reason: 'ptzDisabled' };
  }

  await initialize();
  if (!state.initialized) {
    return {
      action: 'disablePtzEmitters',
      success: false,
      error: state.error || 'PTZ camera is not ready',
    };
  }

  return serializeVendorState(async () => {
    const lightPayload = { channel: 0, state: spotlightCameraStateForLogicalOn(false) };
    const irPayload = { channel: 0, state: normalizeIrState('off') };

    /*
      Set the public state before the API calls finish so the UI immediately
      reflects the idle policy. These API calls intentionally use the same
      fixed-interval reconnect loop as user controls, because idle cleanup is
      only useful if it survives a camera API session reset instead of giving up
      and leaving emitters in an unknown physical state.
    */
    state.light = normalizeSpotlightState({
      ...(state.light || {}),
      ...lightPayload,
      on: false,
    });
    state.ir = {
      ...(state.ir || {}),
      ...irPayload,
    };
    emitChange('idle-emitters-off-pending');

    await callReolinkApi('SetWhiteLed', { WhiteLed: lightPayload });
    await callReolinkApi('SetIrLights', { IrLights: irPayload });

    /*
      Read back once after the writes so stale optimistic state does not linger
      forever. The existing spotlight button path delays verification because it
      is user-facing and frequently toggled; idle fires rarely, so one ordered
      refresh keeps the final state simple.
    */
    await refreshVendorState();

    emitChange('idle-emitters-off');
    return {
      action: 'disablePtzEmitters',
      success: true,
      failures: [],
    };
  });
}

function canRequestLiveVideo(socket) {
  if (!enabled || !passesMode(socket)) return false;
  if (state.operatorSocketId === socket?.id) return true;
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
    socket.on('ptzCamera:claim', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, state: await claim(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:release', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, state: await release(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:move', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb(await move(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:stop', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb(await stop(socket));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:status', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, status: await getStatus(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:spotlight', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, light: await setSpotlight(socket, payload) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:ir', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, ir: await setIr(socket, payload) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:presets:list', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, presets: await listPresets(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:preset:goto', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb(await gotoPreset(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:preset:create', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb(await createPreset(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:preset:remove', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb(await removePreset(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:snapshotSubscribe', (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        if (!passesMode(socket)) throw new Error('Not authorized for PTZ snapshots');
        const ids = normalizeSnapshotIds(payload);
        addSnapshotSubscription(socket, ids);
        if (lastSnapshotState?.frame) sendSnapshotFrame(socket, lastSnapshotState.frame, lastSnapshotState.ts);
        cb({ ok: true, subscribed: ids });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:snapshotUnsubscribe', (firstArg, secondArg) => {
      const { payload } = normalizeSocketArgs(firstArg, secondArg);
      removeSnapshotSubscriptions(socket.id, normalizeSnapshotIds(payload));
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
  getChatTargetForSocket,
  getParticipantSocketIds,
  canSpeakThroughPtz,
  speakText,
  canRequestLiveVideo,
  disableEmittersForIdle,
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
    const inputUrl = `srt://127.0.0.1:9000?streamid=read:${encodeURIComponent(PTZ_STREAM_PATH)}`;
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
