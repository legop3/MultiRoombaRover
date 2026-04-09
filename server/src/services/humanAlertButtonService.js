const sharp = require('sharp');
const logger = require('../globals/logger').child('humanAlertButton');
const { subscribe, publishEvent } = require('./eventBus');
const { getMode, MODES, setMode } = require('./modeManager');
const { issueCommand } = require('./commandService');
const roverManager = require('./roverManager');
const { getRoomCameras } = require('./roomCameraService');
const { getRoomCameraState } = require('./roomCameraSnapshotService');

const HA_BUTTON_EVENT_TYPE = 'ha.button.action';
const HUMAN_ALERT_ACTION = 'humanAlert';
const MODE_TURNS_ACTION = 'modeTurns';
const MODE_ADMIN_ACTION = 'modeAdmin';
const HUMAN_ALERT_MESSAGE = 'Human alert button pressed.';
const MODE_TURNS_TTS = 'Server mode is now turns.';
const MODE_ADMIN_TTS = 'Server mode is now admin.';
const TILE_WIDTH = 480;
const TILE_HEIGHT = 270;

logger.info('HA button actions enabled', {
  actions: [HUMAN_ALERT_ACTION, MODE_TURNS_ACTION, MODE_ADMIN_ACTION],
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
    return;
  }
  if (action === MODE_ADMIN_ACTION) {
    setMode(
      MODES.ADMIN,
      { data: { user: { username: 'ha-button:modeAdmin' } } },
      { force: true },
    );
    sendTtsToNonPrivateRovers(MODE_ADMIN_TTS);
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
}

subscribe(HA_BUTTON_EVENT_TYPE, (event) => {
  handleTrigger(event).catch((err) => {
    logger.warn('Failed handling human alert trigger', { error: err.message });
  });
});

module.exports = {};
