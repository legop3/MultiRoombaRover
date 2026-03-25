const roverManager = require('./roverManager');
const { getRoomCameras } = require('./roomCameraService');

function getReplaySources(socket = null) {
  const roster = socket ? roverManager.getRosterForSocket(socket) : roverManager.getRoster();
  const roverSources = roster
    .filter((rover) => roverManager.canReplayRoverId(rover.id))
    .map((rover) => ({
      type: 'rover',
      id: String(rover.id),
      label: rover.name || rover.id,
      color: rover.color || null,
    }));
  const roomSources = getRoomCameras().map((camera) => ({
    type: 'room',
    id: String(camera.id),
    label: camera.name || camera.id,
  }));
  return [...roverSources, ...roomSources];
}

function normalizeSource(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const [type, id] = entry.split(':');
    if (!type || !id) return null;
    return { type, id: String(id) };
  }
  if (typeof entry === 'object') {
    if (entry.type && entry.id) {
      return { type: entry.type, id: String(entry.id) };
    }
  }
  return null;
}

function validateSources(list = [], socket = null) {
  const allowed = new Map();
  getReplaySources(socket).forEach((source) => {
    allowed.set(`${source.type}:${source.id}`, source);
  });
  const unique = new Map();
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const normalized = normalizeSource(entry);
    if (!normalized) return;
    const key = `${normalized.type}:${normalized.id}`;
    const source = allowed.get(key);
    if (!source) return;
    unique.set(key, { type: source.type, id: source.id, label: source.label });
  });
  return Array.from(unique.values());
}

function getDefaultWebSources(assignment = {}, socket = null) {
  if (assignment?.roverId) {
    const id = String(assignment.roverId);
    const match = getReplaySources(socket).find((entry) => entry.type === 'rover' && entry.id === id);
    if (!match) return [];
    return [{ type: 'rover', id, label: match.label || id }];
  }
  return [];
}

function getDefaultDiscordSources() {
  return getRoomCameras().map((camera) => ({
    type: 'room',
    id: String(camera.id),
    label: camera.name || camera.id,
  }));
}

module.exports = {
  getReplaySources,
  validateSources,
  getDefaultWebSources,
  getDefaultDiscordSources,
};
