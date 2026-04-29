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
const { issueCommand } = require('../commandService');

const audioLevelsEvents = new EventEmitter();
const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('audio-levels.json');
const config = loadConfig();
const configuredDefaults = config.audioLevels || {};

const DEFAULTS = {
  hornGain: clampGain(configuredDefaults.hornGain, 1),
  ttsGain: clampGain(configuredDefaults.ttsGain, 1),
  forwardGain: clampGain(configuredDefaults.forwardGain, 1),
};

function clampGain(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(4, num));
}

function normalizeStore(raw = {}) {
  return {
    hornGain: clampGain(raw.hornGain, DEFAULTS.hornGain),
    ttsGain: clampGain(raw.ttsGain, DEFAULTS.ttsGain),
    forwardGain: clampGain(raw.forwardGain, DEFAULTS.forwardGain),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
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
    updatedAt: current.updatedAt,
    updatedBy: current.updatedBy,
  };
}

function emitChange(reason = 'update') {
  audioLevelsEvents.emit('change', {
    reason,
    levels: getAudioLevels(),
  });
}

function pushLevelsToRover(roverId) {
  if (!roverId) return;
  const record = roverManager.rovers.get(roverId);
  if (!record || !record.ws) return;
  try {
    issueCommand(roverId, {
      type: 'audioLevels',
      audioLevels: getAudioLevels(),
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

roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
  if (action === 'upsert' && roverId) {
    pushLevelsToRover(roverId);
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
});

loadState();

module.exports = {
  getAudioLevels,
  setAudioLevels,
  pushLevelsToRover,
  audioLevelsEvents,
};
