const { spawn } = require('child_process');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('roomAudio');
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const { getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');
const { getMode, MODES } = require('../modeManager');
const { getRole, isAdmin, isLockdownAdmin } = require('../roleService');
const { canBecomeSpectator } = require('../authService');
const { isDeterred } = require('../verificationService');
const videoSessions = require('../videoSessions');
const roomAudioEvents = new EventEmitter();
const sources = new Map();
const mediaSessions = new Map();
let enabled = false;
let active = [];
let polling = false;
let generation = 0;

function canListen(socket) {
  if (!enabled || !socket) return false;
  const mode = getMode();
  if (mode === MODES.LOCKDOWN) return isLockdownAdmin(socket);
  if (isAdmin(socket)) return true;
  if (getRole(socket) === 'spectator') return canBecomeSpectator(socket);
  // Room audio follows general driving eligibility, without tying listening
  // to rover assignment, private-rover access, or the current driving turn.
  return getRole(socket) === 'user' && mode !== MODES.ADMIN && !isDeterred(socket);
}
function canPublish(socket, id) {
  return enabled && isLocalNetwork(getSocketIp(socket)) && sources.get(id)?.socketId === socket.id;
}
function getRoomAudioStreams(socket) { return canListen(socket) ? active : []; }
function getActiveRoomAudioStreams() { return active; }
function trackMediaSession(id, token) { if (id) mediaSessions.set(id, token); }
function hasStream(id) { return active.some((source) => source.id === id); }
function stopSource(id) {
  const source = sources.get(id);
  if (!source) return;
  sources.delete(id);
  clearTimeout(source.timer);
  source.child?.kill('SIGTERM');
  videoSessions.revokeWhere((info) => ['roomAudio', 'roomMic'].includes(info.sourceType) && info.sourceId === id);
  active = active.filter((entry) => entry.id !== id);
  roomAudioEvents.emit('update');
}
function startWorker(source) {
  if (sources.get(source.id) !== source) return;
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'warning'];
  if (source.type === 'device') args.push('-f', 'alsa');
  else if (/^rtsps?:/i.test(source.input)) args.push('-rtsp_transport', 'tcp', '-timeout', '10000000');
  else args.push('-rw_timeout', '10000000');
  args.push('-i', source.input, '-map', '0:a:0', '-vn', '-c:a', 'libopus', '-ar', '48000', '-ac', '1', '-b:a', '64k', '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:8554/room-audio/${source.id}`);
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  source.child = child;
  child.stderr.on('data', (data) => logger.warn('Room audio %s: %s', source.name, String(data).trim()));
  child.on('error', (error) => logger.warn('Room audio %s: %s', source.name, error.message));
  child.on('close', () => {
    if (sources.get(source.id) !== source) return;
    source.child = null;
    source.timer = setTimeout(() => startWorker(source), 2000);
  });
}
function applyConfig(config = {}) {
  const ids = (config.sources || []).map((source) => source.id);
  if (new Set(ids).size !== ids.length) throw new Error('Room audio source IDs must be unique');
  generation += 1;
  enabled = Boolean(config.enabled);
  const configured = new Map((config.sources || []).map((entry) => {
    const source = { ...entry, id: `static-${entry.id}` };
    return [source.id, source];
  }));
  for (const [id, source] of sources) {
    const next = configured.get(id);
    // Static-source edits should not interrupt browser microphones or restart
    // unchanged captures. Disabling the feature still stops every source.
    if (!enabled || (!source.socketId && (!next || next.type !== source.type || next.input !== source.input))) stopSource(id);
  }
  if (enabled) for (const [id, source] of configured) {
    const existing = sources.get(id);
    if (existing) existing.name = source.name;
    else {
      sources.set(id, source);
      startWorker(source);
    }
  }
  roomAudioEvents.emit('update');
}
async function listMediaMtxItems(collection) {
  const items = [];
  let page = 0;
  let pageCount = 1;
  while (page < pageCount) {
    const response = await fetch(`http://127.0.0.1:9997/v3/${collection}/list?page=${page}`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error('MediaMTX unavailable');
    const data = await response.json();
    items.push(...(data.items || []));
    pageCount = data.pageCount || 1;
    page += 1;
  }
  return items;
}

// Advertise actual ready MediaMTX paths, rather than a browser reservation or
// an ffmpeg process that may still be trying to connect to its input.
async function refreshStreams() {
  if ((!enabled && !mediaSessions.size) || polling) return;
  polling = true;
  const currentGeneration = generation;
  let ready = new Set();
  try {
    // HTTP authorization is checked at connection time. Recheck established
    // browser sessions too so lockdown, disable, and disconnect stop live audio.
    const previousSessionIds = [...mediaSessions.keys()];
    const sessions = await listMediaMtxItems('webrtcsessions');
    const liveSessionIds = new Set(sessions.map((session) => session.id));
    for (const session of sessions) {
      if (!session.path?.startsWith('room-audio/')) continue;
      const info = videoSessions.getSession(mediaSessions.get(session.id));
      const socket = info && io.sockets.sockets.get(info.socketId);
      const allowed = socket && (session.state === 'publish'
        ? info.sourceType === 'roomMic' && canPublish(socket, info.sourceId)
        : info.sourceType === 'roomAudio' && canListen(socket));
      if (!allowed) await fetch(`http://127.0.0.1:9997/v3/webrtcsessions/kick/${session.id}`, { method: 'POST', signal: AbortSignal.timeout(1500) });
    }
    for (const id of previousSessionIds) if (!liveSessionIds.has(id)) mediaSessions.delete(id);
  } catch (error) {
    logger.warn('Room audio permission refresh failed: %s', error.message);
  }
  // Permission API failures must not make ready streams disappear. Only path
  // discovery determines the catalog used by playback and replay capture.
  try {
    const paths = await listMediaMtxItems('paths');
    for (const path of paths) if (path.ready) ready.add(path.name);
  } catch { ready = new Set(); }
  finally { polling = false; }
  if (generation !== currentGeneration) return;
  const next = [...sources.values()].filter((source) => ready.has(`room-audio/${source.id}`)).map(({ id, name }) => ({ id, name }));
  if (JSON.stringify(next) !== JSON.stringify(active)) {
    active = next;
    roomAudioEvents.emit('update');
  }
}
io.on('connection', (socket) => {
  socket.on('roomAudio:start', (_payload, cb = () => {}) => {
    if (!enabled || !isLocalNetwork(getSocketIp(socket))) return cb({ error: 'Room microphone publishing requires a local visitor and enabled room audio.' });
    // One owned path per socket; retries replace credentials without accumulating streams.
    const id = `mic-${socket.id}`;
    videoSessions.revokeWhere((info) => info.sourceType === 'roomMic' && info.sourceId === id);
    sources.set(id, { id, name: 'Room microphone', socketId: socket.id });
    const token = videoSessions.createSession(socket, { type: 'roomMic', id });
    cb({ id, token, url: `/video/room-audio/${id}/whip` });
  });
  socket.on('roomAudio:release', ({ token } = {}) => {
    const info = videoSessions.getSession(token);
    if (info?.socketId === socket.id && info.sourceType === 'roomAudio') videoSessions.revokeSession(token);
  });
  socket.on('roomAudio:stop', (_payload, cb = () => {}) => {
    stopSource(`mic-${socket.id}`);
    cb({ success: true });
  });
  socket.on('disconnect', () => {
    stopSource(`mic-${socket.id}`);
  });
});
applyConfig(loadConfig().roomAudio);
registerConfigurationHandler('roomAudio', applyConfig);
const pollTimer = setInterval(refreshStreams, 2000);
pollTimer.unref();
process.once('exit', () => { for (const source of sources.values()) source.child?.kill('SIGTERM'); });
module.exports = { getActiveRoomAudioStreams, trackMediaSession, roomAudioEvents, getRoomAudioStreams, canListen, canPublish, hasStream };
