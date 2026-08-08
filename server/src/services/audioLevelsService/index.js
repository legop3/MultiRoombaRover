// audio Levels Service
// Purpose: Defines the audio Levels Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fs = require('fs');
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('audioLevelsService');
const { loadConfig } = require('../../helpers/configLoader');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const { isAdmin, roleEvents } = require('../roleService');
const roverManager = require('../roverManager');
const { identityEvents, getUserIdForSocket, hasUserPermission } = require('../identityService');
const { issueCommand } = require('../commandService');
const {
  ADJUSTMENT_FIELDS,
  clampGain,
  clampMaximumAdjustmentPercent,
  normalizeAdjustments,
  applyAdjustments,
} = require('./gainMath');

const audioLevelsEvents = new EventEmitter();
const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('audio-levels.json');
const config = loadConfig();
const configuredDefaults = config.audioLevels || {};
const PERSONAL_ADJUSTMENT_PERMISSION = 'audio.personalAdjustment';
const DEFAULT_MAX_PERSONAL_ADJUSTMENT_PERCENT = 50;

const DEFAULTS = {
  hornGain: clampGain(configuredDefaults.hornGain, 1),
  ttsGain: clampGain(configuredDefaults.ttsGain, 1),
  forwardGain: clampGain(configuredDefaults.forwardGain, 1),
  maxPersonalAdjustmentPercent: clampMaximumAdjustmentPercent(
    configuredDefaults.maxPersonalAdjustmentPercent,
    DEFAULT_MAX_PERSONAL_ADJUSTMENT_PERCENT,
  ),
};

function normalizeStore(raw = {}) {
  return {
    hornGain: clampGain(raw.hornGain, DEFAULTS.hornGain),
    ttsGain: clampGain(raw.ttsGain, DEFAULTS.ttsGain),
    forwardGain: clampGain(raw.forwardGain, DEFAULTS.forwardGain),
    maxPersonalAdjustmentPercent: clampMaximumAdjustmentPercent(
      raw.maxPersonalAdjustmentPercent,
      DEFAULTS.maxPersonalAdjustmentPercent,
    ),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
    adjustmentRangeUpdatedAt: Number.isFinite(raw.adjustmentRangeUpdatedAt) ? raw.adjustmentRangeUpdatedAt : null,
    adjustmentRangeUpdatedBy: typeof raw.adjustmentRangeUpdatedBy === 'string' ? raw.adjustmentRangeUpdatedBy : null,
  };
}

let state = null;

function loadState() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    state = normalizeStore(raw);
    if (Object.prototype.hasOwnProperty.call(raw, 'userGainCaps')) {
      // Rewrite once so the retired VIP-cap object does not linger beside the
      // new percentage range and confuse future operator inspection.
      persistState(state);
    }
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
    maxPersonalAdjustmentPercent: current.maxPersonalAdjustmentPercent,
    updatedAt: current.updatedAt,
    updatedBy: current.updatedBy,
    adjustmentRangeUpdatedAt: current.adjustmentRangeUpdatedAt,
    adjustmentRangeUpdatedBy: current.adjustmentRangeUpdatedBy,
  };
}

function emitChange(reason = 'update', extra = {}) {
  audioLevelsEvents.emit('change', {
    reason,
    levels: getAudioLevels(),
    ...extra,
  });
}

function getAdminLimits() {
  const current = loadState();
  return {
    hornGain: current.hornGain,
    ttsGain: current.ttsGain,
    forwardGain: current.forwardGain,
  };
}

function canUsePersonalAdjustments(socket) {
  if (isAdmin(socket)) return true;
  const userId = getUserIdForSocket(socket);
  return Boolean(userId && hasUserPermission(userId, PERSONAL_ADJUSTMENT_PERMISSION));
}

function getAdjustmentsForSocket(socket) {
  if (!canUsePersonalAdjustments(socket)) return normalizeAdjustments({}, 0);
  return normalizeAdjustments(socket?.data?.audioAdjustments, loadState().maxPersonalAdjustmentPercent);
}

function getEffectiveLevelsForSocket(socket) {
  return applyAdjustments(getAdminLimits(), getAdjustmentsForSocket(socket));
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
  return owner ? getEffectiveLevelsForSocket(owner) : getAdminLimits();
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

function setMaxPersonalAdjustmentPercent(value, actor = null) {
  const current = loadState();
  const next = {
    ...current,
    maxPersonalAdjustmentPercent: clampMaximumAdjustmentPercent(value, current.maxPersonalAdjustmentPercent),
    adjustmentRangeUpdatedAt: Date.now(),
    adjustmentRangeUpdatedBy: actor,
  };
  persistState(next);
  /*
    A narrower range must take effect immediately for current drivers rather
    than leaving an out-of-range multiplier active until their next turn.
  */
  pushLevelsToAllRovers();
  emitChange('personal_adjustment_range_set');
  return loadState().maxPersonalAdjustmentPercent;
}

function setSocketAdjustments(socket, input = {}) {
  socket.data = socket.data || {};
  // Store only server-normalized percentages on the transport. The cookie is a
  // browser preference, while permission and range enforcement remain here.
  socket.data.audioAdjustments = normalizeAdjustments(input, 100);
  pushLevelsForSocket(socket);
  emitChange('personal_adjustments_set', { scope: 'socket', socketId: socket.id });
  return getAudioAdjustmentStateForSocket(socket);
}

/*
  The client receives the percentages the server accepted, the permitted range,
  and the resulting multipliers. This keeps the UI honest even when a cookie was
  edited or an administrator changed permission while the browser was online.
*/
function getAudioAdjustmentStateForSocket(socket) {
  const allowed = canUsePersonalAdjustments(socket);
  const maximum = loadState().maxPersonalAdjustmentPercent;
  const values = allowed ? getAdjustmentsForSocket(socket) : normalizeAdjustments({}, 0);
  return {
    values,
    allowed,
    maxAdjustmentPercent: maximum,
    effective: applyAdjustments(getAdminLimits(), values),
    baseLevels: getAdminLimits(),
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

identityEvents.on('change', ({ reason, userId } = {}) => {
  if (!userId || !['permission_granted', 'permission_revoked', 'identify'].includes(reason)) return;
  io.sockets.sockets.forEach((socket) => {
    if (getUserIdForSocket(socket) !== userId) return;
    pushLevelsForSocket(socket);
    // Permission changes alter both effective rover output and the controls the
    // browser may use, so each affected connection receives a fresh session.
    emitChange('personal_adjustment_permission_changed', { scope: 'socket', socketId: socket.id });
  });
});

roleEvents.on('change', ({ socket } = {}) => {
  // Administrators implicitly have this capability, so login/logout can change
  // the effective adjustment even though no database permission row changed.
  if (socket) pushLevelsForSocket(socket);
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

  socket.on('audioLevels:setPersonalAdjustmentRange', (payload = {}, cb = () => {}) => {
    try {
      if (!isAdmin(socket)) {
        throw new Error('Not authorized');
      }
      const actor = socket?.data?.user?.username || null;
      const maxPersonalAdjustmentPercent = setMaxPersonalAdjustmentPercent(payload?.maxAdjustmentPercent, actor);
      cb({ success: true, maxPersonalAdjustmentPercent });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audioLevels:getPersonalAdjustments', (_, cb = () => {}) => {
    try {
      cb({ success: true, audioAdjustments: getAudioAdjustmentStateForSocket(socket) });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('audioLevels:setPersonalAdjustments', (payload = {}, cb = () => {}) => {
    try {
      cb({ success: true, audioAdjustments: setSocketAdjustments(socket, payload || {}) });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

loadState();

module.exports = {
  ADJUSTMENT_FIELDS,
  PERSONAL_ADJUSTMENT_PERMISSION,
  DEFAULT_MAX_PERSONAL_ADJUSTMENT_PERCENT,
  getAudioLevels,
  setAudioLevels,
  setMaxPersonalAdjustmentPercent,
  setSocketAdjustments,
  getEffectiveLevelsForSocket,
  getAudioAdjustmentStateForSocket,
  pushLevelsToRover,
  audioLevelsEvents,
};
