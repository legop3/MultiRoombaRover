// audio Levels Service
// Purpose: Defines the audio Levels Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fs = require('fs');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('audioLevelsService');
const { loadConfig } = require('../../helpers/configLoader');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const { isAdmin } = require('../roleService');
const roverManager = require('../roverManager');
const { getFeatureState, setFeatureState, getUserIdForSocket } = require('../identityService');
const { issueCommand } = require('../commandService');

const audioLevelsEvents = new EventEmitter();
const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('audio-levels.json');
const config = loadConfig();
const configuredDefaults = config.audioLevels || {};
const configuredUserCaps = configuredDefaults.userGainCaps || {};

/*
  The three gain keys are the same on every layer of this feature: the global
  admin gains, the admin-editable VIP boost caps, and each user's personal
  preference. Iterating one list keeps those layers from drifting apart.
*/
const GAIN_KEYS = ['hornGain', 'ttsGain', 'forwardGain'];

/*
  Per-user preferences live in identity feature state so they follow the user
  across browsers and cannot be raised by editing a client-side cookie. They are
  stored as a 0..1 fraction of whatever ceiling currently applies rather than an
  absolute gain, so lowering the global admin gain immediately quiets everyone
  without having to rewrite every stored preference.
*/
const USER_GAINS_NAMESPACE = 'audioGains';

/*
  Absolute ceilings for users holding the audioGainBoost flag. These are the
  hard caps the flag cannot exceed; admins can retune them from the driver page.
*/
const USER_GAIN_CAP_DEFAULTS = {
  hornGain: 0.5,
  ttsGain: 0.8,
  forwardGain: 0.4,
};

function clampGain(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(4, num));
}

function clampFraction(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

const DEFAULTS = {
  hornGain: clampGain(configuredDefaults.hornGain, 1),
  ttsGain: clampGain(configuredDefaults.ttsGain, 1),
  forwardGain: clampGain(configuredDefaults.forwardGain, 1),
  userGainCaps: {
    hornGain: clampGain(configuredUserCaps.hornGain, USER_GAIN_CAP_DEFAULTS.hornGain),
    ttsGain: clampGain(configuredUserCaps.ttsGain, USER_GAIN_CAP_DEFAULTS.ttsGain),
    forwardGain: clampGain(configuredUserCaps.forwardGain, USER_GAIN_CAP_DEFAULTS.forwardGain),
  },
};

function normalizeUserGainCaps(raw = {}, fallback = DEFAULTS.userGainCaps) {
  return {
    hornGain: clampGain(raw?.hornGain, fallback.hornGain),
    ttsGain: clampGain(raw?.ttsGain, fallback.ttsGain),
    forwardGain: clampGain(raw?.forwardGain, fallback.forwardGain),
  };
}

function normalizeStore(raw = {}) {
  return {
    hornGain: clampGain(raw.hornGain, DEFAULTS.hornGain),
    ttsGain: clampGain(raw.ttsGain, DEFAULTS.ttsGain),
    forwardGain: clampGain(raw.forwardGain, DEFAULTS.forwardGain),
    userGainCaps: normalizeUserGainCaps(raw.userGainCaps),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
    capsUpdatedAt: Number.isFinite(raw.capsUpdatedAt) ? raw.capsUpdatedAt : null,
    capsUpdatedBy: typeof raw.capsUpdatedBy === 'string' ? raw.capsUpdatedBy : null,
  };
}

let state = null;

function loadState() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    state = normalizeStore(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load audio levels store', err.message);
    }
    state = normalizeStore({});
  }
  return state;
}

function persistState(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const normalized = normalizeStore(next);
  const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, STORE_PATH);
  state = normalized;
  return state;
}

function getAudioLevels() {
  const current = loadState();
  return {
    hornGain: current.hornGain,
    ttsGain: current.ttsGain,
    forwardGain: current.forwardGain,
    userGainCaps: { ...current.userGainCaps },
    updatedAt: current.updatedAt,
    updatedBy: current.updatedBy,
    capsUpdatedAt: current.capsUpdatedAt,
    capsUpdatedBy: current.capsUpdatedBy,
  };
}

function getUserGainCaps() {
  return { ...loadState().userGainCaps };
}

function emitChange(reason = 'update', extra = {}) {
  audioLevelsEvents.emit('change', {
    reason,
    levels: getAudioLevels(),
    ...extra,
  });
}

/*
  Ceiling resolution. A user without the boost flag can never exceed the global
  admin gain. The flag raises the ceiling to the admin-managed hard cap, and
  Math.max keeps the flag from ever being a downgrade: if an admin runs the
  global gain higher than the boost cap, a boosted user simply keeps the global
  ceiling instead of losing volume for holding a permission.
*/
function getGainCeilings(hasBoost) {
  const current = loadState();
  const caps = current.userGainCaps;
  const ceilings = {};
  GAIN_KEYS.forEach((key) => {
    const adminCeiling = clampGain(current[key], 0);
    ceilings[key] = hasBoost ? Math.max(adminCeiling, clampGain(caps[key], 0)) : adminCeiling;
  });
  return ceilings;
}

function getGainCeilingsForSocket(socket) {
  return getGainCeilings(Boolean(socket?.data?.hasAudioGainBoost));
}

function normalizeUserGains(raw = {}) {
  const out = {};
  GAIN_KEYS.forEach((key) => {
    out[key] = clampFraction(raw?.[key], 1);
  });
  return out;
}

function getUserGains(userId) {
  if (!userId) return normalizeUserGains({});
  return normalizeUserGains(getFeatureState(userId, USER_GAINS_NAMESPACE, {}));
}

function getUserGainsForSocket(socket) {
  return getUserGains(getUserIdForSocket(socket));
}

function applyCeilings(fractions, ceilings) {
  const out = {};
  GAIN_KEYS.forEach((key) => {
    out[key] = clampGain(clampFraction(fractions?.[key], 1) * clampGain(ceilings?.[key], 0), 0);
  });
  return out;
}

function getEffectiveLevelsForSocket(socket) {
  return applyCeilings(getUserGainsForSocket(socket), getGainCeilingsForSocket(socket));
}

/*
  The rover applies gain as three ALSA master controls, so only one set of gains
  can be live per rover at a time. That is not a limitation in practice: horn,
  TTS, and mic forwarding are all restricted to the socket currently holding
  audio control, so pushing that socket's resolved gains gives genuinely
  per-user volume. When nobody owns audio the global admin gains apply.
*/
function resolveAudioOwnerSocket(roverId) {
  const record = roverManager.rovers.get(roverId);
  if (!record) return null;
  const driverIds = Array.from(record.drivers || []);
  if (!driverIds.length) return null;

  // Required lazily: turnService reaches back into roverManager during startup.
  let activeSocketId = null;
  try {
    activeSocketId = require('../turnService').getActiveDrivers()[roverId] || null;
  } catch (err) {
    logger.warn('Failed to resolve active driver for audio levels', roverId, err.message);
  }

  const chosenId = activeSocketId && driverIds.includes(activeSocketId)
    ? activeSocketId
    : (driverIds.length === 1 ? driverIds[0] : null);
  if (!chosenId) return null;
  return io.sockets.sockets.get(chosenId) || null;
}

function resolveLevelsForRover(roverId) {
  const owner = resolveAudioOwnerSocket(roverId);
  if (!owner) {
    const current = loadState();
    return {
      hornGain: current.hornGain,
      ttsGain: current.ttsGain,
      forwardGain: current.forwardGain,
    };
  }
  return getEffectiveLevelsForSocket(owner);
}

function pushLevelsToRover(roverId) {
  if (!roverId) return;
  const record = roverManager.rovers.get(roverId);
  if (!record || !record.ws) return;
  try {
    issueCommand(roverId, {
      type: 'audioLevels',
      audioLevels: resolveLevelsForRover(roverId),
    });
  } catch (err) {
    logger.warn('Failed to push audio levels to rover', roverId, err.message);
  }
}

function pushLevelsToAllRovers() {
  roverManager.rovers.forEach((record, roverId) => {
    if (record?.ws) {
      pushLevelsToRover(roverId);
    }
  });
}

function pushLevelsForSocket(socket) {
  if (!socket) return;
  roverManager.getRoversForSocket(socket.id).forEach((roverId) => pushLevelsToRover(roverId));
}

function setAudioLevels(input = {}, actor = null) {
  const current = loadState();
  const next = {
    ...current,
    hornGain: clampGain(input.hornGain, current.hornGain),
    ttsGain: clampGain(input.ttsGain, current.ttsGain),
    forwardGain: clampGain(input.forwardGain, current.forwardGain),
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  persistState(next);
  pushLevelsToAllRovers();
  emitChange('set');
  return getAudioLevels();
}

function setUserGainCaps(input = {}, actor = null) {
  const current = loadState();
  const next = {
    ...current,
    userGainCaps: normalizeUserGainCaps(input, current.userGainCaps),
    capsUpdatedAt: Date.now(),
    capsUpdatedBy: actor,
  };
  persistState(next);
  /*
    Lowering a cap has to take effect immediately for anyone already driving,
    otherwise a boosted user keeps the louder gain until their next turn.
  */
  pushLevelsToAllRovers();
  emitChange('user_caps_set');
  return getUserGainCaps();
}

function setUserGains(socket, input = {}) {
  const userId = getUserIdForSocket(socket);
  if (!userId) throw new Error('Identity required');
  const current = getUserGains(userId);
  const next = { ...current };
  GAIN_KEYS.forEach((key) => {
    if (input?.[key] === undefined) return;
    next[key] = clampFraction(input[key], current[key]);
  });
  setFeatureState(userId, USER_GAINS_NAMESPACE, next);
  pushLevelsForSocket(socket);
  emitChange('user_gains_set', { scope: 'user', userId });
  return getAudioGainStateForSocket(socket);
}

/*
  The client needs all three layers to render an honest slider: its own stored
  fraction, the ceiling that fraction is measured against, and the resolved gain
  so the UI can show what the rover will actually play.
*/
function getAudioGainStateForSocket(socket) {
  const current = loadState();
  const hasBoost = Boolean(socket?.data?.hasAudioGainBoost);
  const values = getUserGainsForSocket(socket);
  const ceilings = getGainCeilings(hasBoost);
  return {
    values,
    ceilings,
    effective: applyCeilings(values, ceilings),
    boostGranted: hasBoost,
    adminLimits: {
      hornGain: current.hornGain,
      ttsGain: current.ttsGain,
      forwardGain: current.forwardGain,
    },
    boostCaps: { ...current.userGainCaps },
  };
}

roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
  if (action === 'upsert' && roverId) {
    pushLevelsToRover(roverId);
  }
});

/*
  Whoever owns a rover's audio determines which gains are live, so the rover has
  to be re-pushed whenever that ownership moves: joining or leaving a rover, and
  every turn rotation.
*/
roverManager.managerEvents.on('driver', ({ roverId } = {}) => {
  if (roverId) pushLevelsToRover(roverId);
});

setImmediate(() => {
  try {
    require('../turnService').turnEvents.on('queue', ({ roverId } = {}) => {
      if (roverId) pushLevelsToRover(roverId);
    });
  } catch (err) {
    logger.warn('Failed to subscribe to turn changes for audio levels', err.message);
  }
});

io.on('connection', (socket) => {
  socket.on('audioLevels:get', (_, cb = () => {}) => {
    cb({ success: true, levels: getAudioLevels() });
  });

  socket.on('audioLevels:set', (payload = {}, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        throw new Error('Not authorized');
      }
      const actor = socket?.data?.user?.username || null;
      const levels = setAudioLevels(payload || {}, actor);
      cb({ success: true, levels });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audioLevels:setUserCaps', (payload = {}, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        throw new Error('Not authorized');
      }
      const actor = socket?.data?.user?.username || null;
      const userGainCaps = setUserGainCaps(payload || {}, actor);
      cb({ success: true, userGainCaps });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audioLevels:getUserGains', (_, cb = () => {}) => {
    try {
      cb({ success: true, audioGains: getAudioGainStateForSocket(socket) });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audioLevels:setUserGains', (payload = {}, cb = () => {}) => {
    try {
      cb({ success: true, audioGains: setUserGains(socket, payload || {}) });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

loadState();

module.exports = {
  GAIN_KEYS,
  USER_GAIN_CAP_DEFAULTS,
  getAudioLevels,
  setAudioLevels,
  getUserGainCaps,
  setUserGainCaps,
  getUserGains,
  setUserGains,
  getGainCeilingsForSocket,
  getEffectiveLevelsForSocket,
  getAudioGainStateForSocket,
  pushLevelsToRover,
  audioLevelsEvents,
};
