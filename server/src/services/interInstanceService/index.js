// Inter Instance Service
// Purpose: Publishes this server's public instance profile and polls public profiles from peer servers.
// Scope: Owns only the inter-instance directory/API contract; local control, auth, and rover state stay in their existing services.
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const { app } = require('../../globals/http');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('interInstanceService');
const { loadConfig } = require('../../helpers/configLoader');
const { getFeatureFlags, getConfiguredSocials } = require('../../helpers/features');
const { getMode, MODES } = require('../modeManager');
const roverManager = require('../roverManager');
const { getTurnQueues } = require('../turnService');
const { getRoomCameras, getRoomCameraState } = require('../roomCameraService');
const { getRoverSnapshotState } = require('../roverSnapshotService');
const { getRole } = require('../roleService');
const { getNickname } = require('../nicknameService');

const DEFAULT_POLL_INTERVAL_MS = 30000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const INFO_PATH = '/api/inter-instance/info';
const INSTANCE_ID = uuidv4();
const config = loadConfig();
const interInstanceConfig = config.interInstance || {};
const profileConfig = interInstanceConfig.profile || {};
const interInstanceEvents = new EventEmitter();
const remoteInstances = new Map();

let polling = false;
function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  const raw = asTrimmedString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function isEnabled() {
  return Boolean(interInstanceConfig.enabled);
}

function requestTimeoutMs() {
  const value = Number(interInstanceConfig.requestTimeoutMs);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_REQUEST_TIMEOUT_MS;
}

function pollIntervalMs() {
  const value = Number(interInstanceConfig.pollIntervalMs);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_POLL_INTERVAL_MS;
}

function ownPublicUrl() {
  return normalizeBaseUrl(profileConfig.publicUrl);
}

function ownInstanceId() {
  /*
    This id exists only for this Node process. That is enough to detect self
    aliases during a poll cycle because every public URL that reaches this same
    running server returns the same generated value.
  */
  return INSTANCE_ID;
}

function buildPublicUrl(pathname) {
  const base = ownPublicUrl();
  if (!base || !pathname) return null;
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function publicProfile() {
  const publicUrl = ownPublicUrl();
  return {
    id: ownInstanceId(),
    name: asTrimmedString(profileConfig.name) || publicUrl || 'Rover server',
    description: asTrimmedString(profileConfig.description),
    color: asTrimmedString(profileConfig.color),
    publicUrl,
  };
}

function isLockdownMode() {
  return getMode() === MODES.LOCKDOWN;
}

function buildUserEntry(socket) {
  const primaryRover = roverManager.getPrimaryRoverForSocket(socket.id);
  return {
    socketId: socket.id,
    userId: socket?.data?.userId || null,
    nickname: getNickname(socket) || null,
    role: getRole(socket),
    roverId: primaryRover || null,
  };
}

function addRoverSnapshotLinks(rover) {
  const id = String(rover?.id || '').trim();
  if (!id) return rover;
  const state = getRoverSnapshotState(id);
  const latestUrl = buildPublicUrl(`/api/inter-instance/rover-snapshots/${encodeURIComponent(id)}/latest`);
  if (!latestUrl) return rover;
  return {
    ...rover,
    snapshots: {
      latestUrl,
      updatedAt: state?.ts || null,
      error: state?.error || null,
    },
  };
}

function buildRoomCameraInfo(camera) {
  const state = getRoomCameraState(camera.id);
  const snapshotUrl = buildPublicUrl(`/api/inter-instance/room-cameras/${encodeURIComponent(camera.id)}/snapshot`);
  /*
    Room camera config can point at private LAN URLs. The inter-instance payload
    advertises this server's public snapshot endpoint instead, so remote clients
    do not learn or depend on the local camera's internal address.
  */
  return {
    id: camera.id,
    name: camera.name,
    description: camera.description || null,
    snapshotUrl,
    updatedAt: state?.ts || null,
    error: state?.error || null,
  };
}

function isClosedPrivateRover(rover) {
  return Boolean(rover?.private?.enabled && !rover?.private?.open);
}

function getPublicRoster() {
  return roverManager
    .getRoster()
    /*
      Closed private rovers are intentionally absent from the public
      inter-instance contract. If a rover is private and closed, other servers
      should not see its row or receive any derived snapshot URL for it.
    */
    .filter((rover) => !isClosedPrivateRover(rover));
}

function buildLocalInfo() {
  const mode = getMode();
  const lockdown = isLockdownMode();
  const features = getFeatureFlags();
  const roster = getPublicRoster().map((rover) => (lockdown ? rover : addRoverSnapshotLinks(rover)));
  const roomCameras = lockdown || !features.roomCameras ? [] : getRoomCameras().map(buildRoomCameraInfo);
  return {
    instance: {
      ...publicProfile(),
      mode,
      open: mode !== MODES.ADMIN && mode !== MODES.LOCKDOWN,
      features,
      updatedAt: Date.now(),
    },
    roster,
    turnQueues: getTurnQueues(),
    users: Array.from(io.sockets.sockets.values()).map(buildUserEntry),
    roomCameras,
    socials: features.socials ? getConfiguredSocials(config) : [],
  };
}

function sendJpegState(res, state, missingMessage) {
  if (!state?.frame) {
    res.status(404).json({ error: missingMessage });
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.set('X-Rover-Snapshot-Ts', String(state.ts || ''));
  res.type('jpeg').send(state.frame);
}

app.get(INFO_PATH, (req, res) => {
  if (!isEnabled()) {
    res.status(404).json({ error: 'Inter-instance sharing disabled' });
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.json(buildLocalInfo());
});

app.get('/api/inter-instance/rover-snapshots/:roverId/latest', (req, res) => {
  if (!isEnabled() || isLockdownMode()) {
    res.status(404).json({ error: 'Snapshot unavailable' });
    return;
  }
  const roverId = String(req.params.roverId || '');
  const publicRover = getPublicRoster().find((rover) => String(rover.id) === roverId);
  if (!publicRover) {
    /*
      Do not rely on "not advertising the URL" as the privacy boundary. Public
      snapshot hosting must also reject direct requests for closed-private or
      unknown rovers because old URLs, logs, or guesses can outlive roster state.
    */
    res.status(404).json({ error: 'Rover snapshot unavailable' });
    return;
  }
  sendJpegState(res, getRoverSnapshotState(roverId), 'Rover snapshot unavailable');
});

app.get('/api/inter-instance/room-cameras/:cameraId/snapshot', (req, res) => {
  if (!isEnabled() || isLockdownMode()) {
    res.status(404).json({ error: 'Snapshot unavailable' });
    return;
  }
  const cameraId = String(req.params.cameraId || '');
  sendJpegState(res, getRoomCameraState(cameraId), 'Room camera snapshot unavailable');
});

function normalizeDirectoryEntry(entry) {
  if (typeof entry === 'string') {
    const url = normalizeBaseUrl(entry);
    return url ? { url, name: '' } : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const url = normalizeBaseUrl(entry.url || entry.baseUrl || entry.publicUrl);
  if (!url) return null;
  return {
    url,
    name: asTrimmedString(entry.name),
  };
}

function uniqueDirectoryEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry?.url || seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDirectoryEntries() {
  const urls = Array.isArray(interInstanceConfig.directoryUrls)
    ? interInstanceConfig.directoryUrls.map((url) => asTrimmedString(url)).filter(Boolean)
    : [];
  const lists = await Promise.allSettled(urls.map((url) => fetchJson(url)));
  const entries = [];
  lists.forEach((result, idx) => {
    if (result.status !== 'fulfilled') {
      logger.warn('Directory fetch failed', { url: urls[idx], error: result.reason?.message || String(result.reason) });
      return;
    }
    if (!Array.isArray(result.value)) {
      logger.warn('Directory response was not an array', { url: urls[idx] });
      return;
    }
    result.value.forEach((entry) => {
      const normalized = normalizeDirectoryEntry(entry);
      if (normalized) entries.push(normalized);
    });
  });
  const self = ownPublicUrl();
  return uniqueDirectoryEntries(entries).filter((entry) => entry.url !== self);
}

function normalizeRemotePayload(entry, payload) {
  const instance = payload?.instance && typeof payload.instance === 'object' ? payload.instance : {};
  /*
    Remote payloads are intentionally additive. Every read below has a passive
    fallback so older or partially configured servers still produce a useful
    listing instead of breaking the whole directory view.
  */
  return {
    url: entry.url,
    online: true,
    lastSuccessAt: Date.now(),
    lastError: null,
    latencyMs: null,
    instance: {
      ...instance,
      id: asTrimmedString(instance.id),
      name: asTrimmedString(instance.name) || entry.name || entry.url,
      publicUrl: normalizeBaseUrl(instance.publicUrl) || entry.url,
      description: asTrimmedString(instance.description),
      color: asTrimmedString(instance.color),
      features: instance.features && typeof instance.features === 'object' ? instance.features : {},
    },
    roster: Array.isArray(payload?.roster) ? payload.roster : [],
    turnQueues: payload?.turnQueues && typeof payload.turnQueues === 'object' ? payload.turnQueues : {},
    users: Array.isArray(payload?.users) ? payload.users : [],
    roomCameras: Array.isArray(payload?.roomCameras) ? payload.roomCameras : [],
    socials: Array.isArray(payload?.socials) ? payload.socials : [],
  };
}

function remoteIdentityKey(remote) {
  const advertisedId = asTrimmedString(remote?.instance?.id);
  if (advertisedId) return `id:${advertisedId}`;
  const advertisedPublicUrl = normalizeBaseUrl(remote?.instance?.publicUrl);
  if (advertisedPublicUrl) return `url:${advertisedPublicUrl}`;
  return `url:${normalizeBaseUrl(remote?.url) || remote?.url || ''}`;
}

function isSelfRemote(remote) {
  const ownId = ownInstanceId();
  const remoteId = asTrimmedString(remote?.instance?.id);
  if (ownId && remoteId && ownId === remoteId) return true;
  const self = ownPublicUrl();
  const remotePublicUrl = normalizeBaseUrl(remote?.instance?.publicUrl);
  const remoteUrl = normalizeBaseUrl(remote?.url);
  return Boolean(self && (remotePublicUrl === self || remoteUrl === self));
}

function preferRemoteEntry(current, candidate) {
  /*
    When the directory has multiple URLs for one instance, keep the healthier
    entry. Online data beats offline placeholders, and lower latency is a useful
    tiebreaker when two aliases both work.
  */
  if (!current) return candidate;
  if (candidate.online && !current.online) return candidate;
  if (!candidate.online && current.online) return current;
  if (candidate.online && current.online) {
    const currentLatency = Number.isFinite(current.latencyMs) ? current.latencyMs : Infinity;
    const candidateLatency = Number.isFinite(candidate.latencyMs) ? candidate.latencyMs : Infinity;
    return candidateLatency < currentLatency ? candidate : current;
  }
  const currentName = asTrimmedString(current?.instance?.name);
  const candidateName = asTrimmedString(candidate?.instance?.name);
  return !currentName && candidateName ? candidate : current;
}

function replaceRemoteInstances(nextEntries) {
  const deduped = new Map();
  nextEntries.forEach((entry) => {
    if (!entry || isSelfRemote(entry)) return;
    const key = remoteIdentityKey(entry);
    deduped.set(key, preferRemoteEntry(deduped.get(key), entry));
  });
  remoteInstances.clear();
  Array.from(deduped.values()).forEach((entry) => {
    remoteInstances.set(remoteIdentityKey(entry), entry);
  });
}

function markOffline(entry, error) {
  const previous = remoteInstances.get(`url:${entry.url}`) || {};
  return {
    ...previous,
    url: entry.url,
    online: false,
    lastError: error?.message || String(error || 'Unknown error'),
    instance: {
      ...(previous.instance || {}),
      name: previous.instance?.name || entry.name || entry.url,
      publicUrl: previous.instance?.publicUrl || entry.url,
    },
    roster: previous.roster || [],
    turnQueues: previous.turnQueues || {},
    users: previous.users || [],
    roomCameras: previous.roomCameras || [],
    socials: previous.socials || [],
  };
}

async function pollRemoteInstance(entry) {
  const start = Date.now();
  try {
    const payload = await fetchJson(`${entry.url}${INFO_PATH}`);
    const normalized = normalizeRemotePayload(entry, payload);
    normalized.latencyMs = Date.now() - start;
    return normalized;
  } catch (err) {
    return markOffline(entry, err);
  }
}

async function pollNow() {
  if (!isEnabled() || polling) return;
  polling = true;
  try {
    const entries = await fetchDirectoryEntries();
    const nextEntries = await Promise.all(entries.map((entry) => pollRemoteInstance(entry)));
    replaceRemoteInstances(nextEntries);
    interInstanceEvents.emit('change');
  } catch (err) {
    logger.warn('Inter-instance poll failed', { error: err.message });
  } finally {
    polling = false;
  }
}

function startPolling() {
  if (!isEnabled()) return;
  pollNow();
  setInterval(pollNow, pollIntervalMs());
}

function getState() {
  return {
    enabled: isEnabled(),
    profile: publicProfile(),
    instances: Array.from(remoteInstances.values()).sort((a, b) =>
      String(a.instance?.name || a.url).localeCompare(String(b.instance?.name || b.url)),
    ),
  };
}

startPolling();

module.exports = {
  getState,
  interInstanceEvents,
  buildLocalInfo,
  pollNow,
};
