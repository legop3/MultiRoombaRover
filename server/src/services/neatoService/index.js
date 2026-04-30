// neato Service
// Purpose: Defines the neato Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('neatoService');
const { loadConfig } = require('../../helpers/configLoader');
const { isVerified } = require('../verificationService');
const {
  homeAssistantEvents,
  getRawEntitySnapshot,
  callHomeAssistantService,
  isConnected: isHomeAssistantConnected,
  enabled: homeAssistantEnabled,
} = require('../homeAssistantService');

const events = new EventEmitter();
const config = loadConfig();
const haConfig = config.homeAssistant || {};
const neatoConfig = haConfig.neato || {};

function normalizeDeviceName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

const device = normalizeDeviceName(neatoConfig.device);

function entityId(domain, suffix) {
  if (!device) return '';
  return `${domain}.${device}_${suffix}`;
}

const ENTITY_IDS = {
  buttons: {
    start: entityId('button', 'house_clean'),
    sendHome: entityId('button', 'send_to_base'),
    locate: entityId('button', 'locate_robot'),
    clearErrors: entityId('button', 'clear_errors'),
  },
  sensors: {
    batteryPercent: entityId('sensor', 'fuel_percent'),
    batteryVoltage: entityId('sensor', 'battery_voltage_v'),
  },
  binarySensors: {
    chargingActive: entityId('binary_sensor', 'charging_active'),
    extPowerPresent: entityId('binary_sensor', 'ext_power_present'),
  },
  textSensors: {
    // ESPHome text_sensor entities surface in Home Assistant under the sensor domain.
    uiState: entityId('sensor', 'ui_state'),
    robotError: entityId('sensor', 'robot_error'),
    robotAlert: entityId('sensor', 'robot_alert'),
  },
};

function readRaw(entityIdValue) {
  if (!entityIdValue) return null;
  return getRawEntitySnapshot(entityIdValue);
}

function readState(entityIdValue) {
  const raw = readRaw(entityIdValue);
  return raw?.state ?? null;
}

function parseNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function isBinaryOn(value) {
  return String(value || '').toLowerCase() === 'on';
}

function hasEntity(entityIdValue) {
  return Boolean(readRaw(entityIdValue));
}

function isEntityAvailable(entityIdValue) {
  const raw = readRaw(entityIdValue);
  if (!raw) return false;
  const state = String(raw.state ?? '').trim().toLowerCase();
  if (!state) return false;
  return state !== 'unavailable';
}

function requiredEntityIds() {
  return [
    ENTITY_IDS.buttons.start,
    ENTITY_IDS.buttons.sendHome,
    ENTITY_IDS.buttons.locate,
    ENTITY_IDS.buttons.clearErrors,
    ENTITY_IDS.sensors.batteryPercent,
    ENTITY_IDS.sensors.batteryVoltage,
    ENTITY_IDS.binarySensors.chargingActive,
    ENTITY_IDS.binarySensors.extPowerPresent,
    ENTITY_IDS.textSensors.uiState,
    ENTITY_IDS.textSensors.robotError,
    ENTITY_IDS.textSensors.robotAlert,
  ].filter(Boolean);
}

function buildState() {
  const configured = Boolean(device);
  const haConnected = isHomeAssistantConnected();
  const requiredIds = requiredEntityIds();
  const entitiesAvailable = requiredIds.length > 0 && requiredIds.every((id) => isEntityAvailable(id));
  const connected = Boolean(haConnected && entitiesAvailable);
  const enabled = Boolean(homeAssistantEnabled && configured);

  const controls = {
    start: {
      entityId: ENTITY_IDS.buttons.start,
      available: hasEntity(ENTITY_IDS.buttons.start),
    },
    sendHome: {
      entityId: ENTITY_IDS.buttons.sendHome,
      available: hasEntity(ENTITY_IDS.buttons.sendHome),
    },
    locate: {
      entityId: ENTITY_IDS.buttons.locate,
      available: hasEntity(ENTITY_IDS.buttons.locate),
    },
    clearErrors: {
      entityId: ENTITY_IDS.buttons.clearErrors,
      available: hasEntity(ENTITY_IDS.buttons.clearErrors),
    },
  };

  const batteryPercentValue = parseNumber(readState(ENTITY_IDS.sensors.batteryPercent));
  const batteryPercent =
    batteryPercentValue == null ? null : Math.max(0, Math.min(100, Math.round(batteryPercentValue)));
  const batteryVoltage = parseNumber(readState(ENTITY_IDS.sensors.batteryVoltage));
  const uiState = readState(ENTITY_IDS.textSensors.uiState);
  const robotError = readState(ENTITY_IDS.textSensors.robotError);
  const robotAlert = readState(ENTITY_IDS.textSensors.robotAlert);
  const chargingActive = isBinaryOn(readState(ENTITY_IDS.binarySensors.chargingActive));
  const extPowerPresent = isBinaryOn(readState(ENTITY_IDS.binarySensors.extPowerPresent));

  return {
    enabled,
    configured,
    connected,
    device,
    entityPrefix: device ? `${device}_` : '',
    controls,
    telemetry: {
      batteryPercent,
      batteryVoltage,
      chargingActive,
      extPowerPresent,
      uiState,
      robotError,
      robotAlert,
    },
    entities: ENTITY_IDS,
  };
}

let cachedState = buildState();

function emitUpdate() {
  const next = buildState();
  const changed = JSON.stringify(next) !== JSON.stringify(cachedState);
  cachedState = next;
  if (changed) {
    events.emit('update', next);
  }
}

homeAssistantEvents.on('snapshot', () => {
  emitUpdate();
});

homeAssistantEvents.on('status', () => {
  emitUpdate();
});

function assertConfiguredAndConnected() {
  if (!device) {
    throw new Error('Neato not configured');
  }
  if (!homeAssistantEnabled) {
    throw new Error('Home Assistant not configured');
  }
  if (!isHomeAssistantConnected()) {
    throw new Error('Home Assistant not connected');
  }
}

async function pressButton(entityIdValue, actionLabel) {
  assertConfiguredAndConnected();
  if (!entityIdValue) {
    throw new Error(`Neato ${actionLabel} entity missing`);
  }
  if (!hasEntity(entityIdValue)) {
    throw new Error(`Neato action unavailable: ${actionLabel}`);
  }
  await callHomeAssistantService('button', 'press', { entity_id: entityIdValue });
  logger.info('Issued Neato action', { action: actionLabel, entityId: entityIdValue });
}

async function startCleaning() {
  await pressButton(ENTITY_IDS.buttons.start, 'start');
}

async function sendHome() {
  await pressButton(ENTITY_IDS.buttons.sendHome, 'send_home');
}

async function locateRobot() {
  await pressButton(ENTITY_IDS.buttons.locate, 'locate');
}

async function clearErrors() {
  await pressButton(ENTITY_IDS.buttons.clearErrors, 'clear_errors');
}

function getState() {
  cachedState = buildState();
  return cachedState;
}

io.on('connection', (socket) => {
  socket.on('neato:start', async (_, cb = () => {}) => {
    try {
      if (!isVerified(socket)) {
        throw new Error('VIP verification required');
      }
      await startCleaning();
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('neato:sendHome', async (_, cb = () => {}) => {
    try {
      if (!isVerified(socket)) {
        throw new Error('VIP verification required');
      }
      await sendHome();
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('neato:locate', async (_, cb = () => {}) => {
    try {
      if (!isVerified(socket)) {
        throw new Error('VIP verification required');
      }
      await locateRobot();
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });

  socket.on('neato:clearErrors', async (_, cb = () => {}) => {
    try {
      if (!isVerified(socket)) {
        throw new Error('VIP verification required');
      }
      await clearErrors();
      cb({ success: true });
    } catch (err) {
      cb({ error: err.message });
    }
  });
});

emitUpdate();

module.exports = {
  getState,
  startCleaning,
  sendHome,
  locateRobot,
  clearErrors,
  neatoEvents: events,
};
