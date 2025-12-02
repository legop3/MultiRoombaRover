const EventEmitter = require('events');
const logger = require('../globals/logger').child('roomCameraService');
const { loadConfig } = require('../helpers/configLoader');

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
  if (!camera.url) {
    logger.warn('Room camera missing url', { id, camera });
    return null;
  }
  return {
    id: String(id),
    name: camera.name || camera.id || String(id),
    description: camera.description || null,
    url: camera.url,
  };
}

function loadFromConfig() {
  cameraMap.clear();
  const list = Array.isArray(config.roomCameras) ? config.roomCameras : [];
  list.forEach((camera) => {
    const normalized = normalizeCamera(camera);
    if (normalized) {
      cameraMap.set(normalized.id, normalized);
    }
  });
  logger.info('Loaded room cameras', { count: cameraMap.size });
  events.emit('update', getRoomCameras());
}

function getRoomCameras() {
  return Array.from(cameraMap.values());
}

function getRoomCamera(id) {
  if (!id) return null;
  return cameraMap.get(String(id)) || null;
}

loadFromConfig();

module.exports = {
  getRoomCameras,
  getRoomCamera,
  roomCameraEvents: events,
};
