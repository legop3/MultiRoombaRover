// Replay Source Selection
// Purpose: Exposes replay source discovery/validation for web and Discord replay requests.
// Scope: Handles user-visible replay source catalogs and default source selection rules.
const roverManager = require('../roverManager');
const { getRoomCameras } = require('../roomCameraService');
const ptzCameraService = require('../ptzCameraService');

function getReplaySources(socket = null) {
  const roster = socket ? roverManager.getRosterForSocket(socket) : roverManager.getRoster();
  const roverSources = roster
    .filter((rover) => roverManager.canReplayRoverId(rover.id, socket))
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

  const ptzSource = ptzCameraService.getReplaySource();
  const ptzSources = ptzSource ? [ptzSource] : [];

  return [...roverSources, ...roomSources, ...ptzSources];
}

function normalizeSource(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const [type, id] = entry.split(':');
    if (!type || !id) return null;
    return { type, id: String(id) };
  }
  if (typeof entry === 'object' && entry.type && entry.id) {
    return { type: entry.type, id: String(entry.id) };
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
  /*
    PTZ ownership is intentionally tracked outside assignmentService because
    taking the camera releases the user's rover assignment. Check the PTZ
    service directly so a source-less web replay request, including `rs
    replay`, follows the camera currently controlled by that socket just as it
    follows an assigned rover below.

    isOperator is deliberately stricter than PTZ access or queue membership:
    spectators and users waiting for a camera turn must not silently replay a
    camera they are not currently operating. Keeping this rule here also makes
    every web replay entry point share the same default instead of teaching the
    chat-command adapter about PTZ-specific state.
  */
  if (ptzCameraService.getPublicState(socket).isOperator) {
    const source = ptzCameraService.getReplaySource();
    if (!source) return [];
    return [{ type: source.type, id: String(source.id), label: source.label || source.id }];
  }

  if (assignment?.roverId) {
    const id = String(assignment.roverId);
    const match = getReplaySources(socket).find((entry) => entry.type === 'rover' && entry.id === id);
    if (!match) return [];
    return [{ type: 'rover', id, label: match.label || id }];
  }
  return [];
}

function getDefaultDiscordSources() {
  const sources = getRoomCameras().map((camera) => ({
    type: 'room',
    id: String(camera.id),
    label: camera.name || camera.id,
  }));
  const ptzSource = ptzCameraService.getReplaySource();
  if (ptzSource) sources.push(ptzSource);
  return sources;
}

module.exports = {
  getReplaySources,
  validateSources,
  getDefaultWebSources,
  getDefaultDiscordSources,
};
