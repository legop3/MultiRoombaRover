// Room Camera Catalog
// Purpose: Loads and normalizes configured room camera entries and emits update events when roster data changes.
// Scope: Owns camera identity/url normalization and read-only accessors for room camera metadata.
const EventEmitter = require('events');
const logger = require('../../globals/logger').child('roomCameraService');
const { loadConfig } = require('../../configuration');

const events = new EventEmitter();
const config = loadConfig();
const cameraMap = new Map();

function normalizeCamera(camera) {
  if (!camera) return null;
  const id = camera.id || camera.name;
  if (!id) {
    logger.warn('Room camera missing id', camera);
    return null;
  }
  if (!camera.url && !camera.streamUrl) {
    logger.warn('Room camera missing url/streamUrl', { id, camera });
    return null;
  }
  return {
    id: String(id),
    name: camera.name || camera.id || String(id),
    description: camera.description || null,
    url: camera.url || null,
    streamUrl: camera.streamUrl || null,
  };
}

function getRoomCameras() {
  return Array.from(cameraMap.values());
}

function getRoomCamera(id) {
  if (!id) return null;
  return cameraMap.get(String(id)) || null;
}

function loadFromConfig() {
  cameraMap.clear();
  // Schema validation guarantees the configured list shape. Keeping its
  // fallback local makes the camera catalog independent of feature projection.
  const list = Array.isArray(config.roomCameras?.cameras) ? config.roomCameras.cameras : [];
  list.forEach((camera) => {
    const normalized = normalizeCamera(camera);
    if (normalized) cameraMap.set(normalized.id, normalized);
  });
  logger.info('Loaded room cameras', { count: cameraMap.size });
  events.emit('update', getRoomCameras());
}

module.exports = {
  loadFromConfig,
  getRoomCameras,
  getRoomCamera,
  roomCameraEvents: events,
};
