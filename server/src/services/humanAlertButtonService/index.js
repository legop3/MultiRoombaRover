// human Alert Button Service
// Purpose: Defines the human Alert Button Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const sharp = require('sharp');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('humanAlertButton');
const { subscribe, publishEvent } = require('../eventBus');
const { getMode, MODES, setMode } = require('../modeManager');
const { issueCommand } = require('../commandService');
const roverManager = require('../roverManager');
const { toggleLightsLockedOn } = require('../homeAssistantService');
const { getRoomCameras } = require('../roomCameraService');
const { getRoomCameraState } = require('../roomCameraService');

const HA_BUTTON_EVENT_TYPE = 'ha.button.action';
const HUMAN_ALERT_ACTION = 'humanAlert';
const MODE_TURNS_ACTION = 'modeTurns';
const MODE_ADMIN_ACTION = 'modeAdmin';
const LIGHTS_LOCK_TOGGLE_ACTION = 'lightsLockToggle';
const HUMAN_ALERT_MESSAGE = 'Human alert button pressed.';
const MODE_TURNS_TTS = 'Server mode is now turns.';
const MODE_ADMIN_TTS = 'Server mode is now admin.';
const LIGHTS_LOCKED_TTS = 'Room lights are now locked on.';
const LIGHTS_UNLOCKED_TTS = 'Room lights are now unlocked.';
const TILE_WIDTH = 480;
const TILE_HEIGHT = 270;
const DISPLAY_NOTICE_DURATION_MS = 4500;

logger.info('HA button actions enabled', {
  actions: [HUMAN_ALERT_ACTION, MODE_TURNS_ACTION, MODE_ADMIN_ACTION, LIGHTS_LOCK_TOGGLE_ACTION],
});

function isModeAllowed() {
  const mode = getMode();
  return mode !== MODES.ADMIN && mode !== MODES.LOCKDOWN;
}

function sendTtsToNonPrivateRovers(text) {
  const roster = roverManager.getRoster();
  roster.forEach((entry) => {
    if (entry?.private?.enabled) return;
    try {
      issueCommand(String(entry.id), {
        type: 'tts',
        tts: {
          text,
          speak: true,
        },
      });
    } catch (err) {
      logger.warn('Failed to send mode TTS', { roverId: entry?.id, error: err.message });
    }
  });
}

function emitDisplayNotice(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  // The room display should show the same successful action feedback that the
  // rovers speak. This socket event is intentionally display-specific so normal
  // driver/admin pages do not inherit a large visual interruption.
  io.emit('display:notice', {
    id: `ha-button-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text: clean,
    source: 'ha-button',
    durationMs: DISPLAY_NOTICE_DURATION_MS,
    ts: Date.now(),
  });
}

async function buildTile(camera, state) {
  const base = sharp({
    create: {
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      channels: 3,
      background: state?.frame ? '#000000' : '#222222',
    },
  });
  if (!state?.frame) {
    return base.jpeg({ quality: 75 }).toBuffer();
  }
  try {
    const frame = await sharp(state.frame)
      .resize(TILE_WIDTH, TILE_HEIGHT, {
        fit: 'cover',
      })
      .jpeg({ quality: 78 })
      .toBuffer();
    return frame;
  } catch (err) {
    logger.warn('Failed to build camera tile from frame', { cameraId: camera.id, error: err.message });
    return base.jpeg({ quality: 75 }).toBuffer();
  }
}

async function buildHorizontalMosaic() {
  const cameras = getRoomCameras();
  if (!cameras.length) return null;
  const width = TILE_WIDTH * cameras.length;
  const height = TILE_HEIGHT;
  const layers = [];
  for (let idx = 0; idx < cameras.length; idx += 1) {
    const cam = cameras[idx];
    const state = getRoomCameraState(cam.id);
    const input = await buildTile(cam, state);
    layers.push({
      input,
      left: idx * TILE_WIDTH,
      top: 0,
    });
  }
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#000000',
    },
  })
    .composite(layers)
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function handleTrigger(event = {}) {
  const action = String(event?.payload?.action || '');
  if (!action) {
    return;
  }
  if (action === MODE_TURNS_ACTION) {
    setMode(
      MODES.TURNS,
      { data: { user: { username: 'ha-button:modeTurns' } } },
      { force: true },
    );
    sendTtsToNonPrivateRovers(MODE_TURNS_TTS);
    emitDisplayNotice(MODE_TURNS_TTS);
    return;
  }
  if (action === MODE_ADMIN_ACTION) {
    setMode(
      MODES.ADMIN,
      { data: { user: { username: 'ha-button:modeAdmin' } } },
      { force: true },
    );
    sendTtsToNonPrivateRovers(MODE_ADMIN_TTS);
    emitDisplayNotice(MODE_ADMIN_TTS);
    return;
  }
  if (action === LIGHTS_LOCK_TOGGLE_ACTION) {
    const lockedOn = await toggleLightsLockedOn({
      source: 'ha-button:lightsLockToggle',
    });
    const message = lockedOn ? LIGHTS_LOCKED_TTS : LIGHTS_UNLOCKED_TTS;
    sendTtsToNonPrivateRovers(message);
    emitDisplayNotice(message);
    return;
  }
  if (action !== HUMAN_ALERT_ACTION) {
    return;
  }
  const now = Date.now();
  if (!isModeAllowed()) {
    logger.info('Ignoring human alert trigger due to mode gate', { mode: getMode() });
    return;
  }
  let mosaic = null;
  try {
    mosaic = await buildHorizontalMosaic();
  } catch (err) {
    logger.warn('Failed to build human alert mosaic', { error: err.message });
  }
  publishEvent({
    source: 'humanAlertButton',
    type: 'humanAlert.buttonPressed',
    payload: {
      message: HUMAN_ALERT_MESSAGE,
      triggeredAt: now,
      imageBase64: mosaic ? mosaic.toString('base64') : null,
      trigger: event?.payload || null,
    },
  });
  emitDisplayNotice(HUMAN_ALERT_MESSAGE);
}

subscribe(HA_BUTTON_EVENT_TYPE, (event) => {
  handleTrigger(event).catch((err) => {
    logger.warn('Failed handling human alert trigger', { error: err.message });
  });
});

module.exports = {};
