// Replay Socket Hooks
// Purpose: Registers web socket replay-trigger handler that publishes replay requests.
// Scope: Applies replay mode/cooldown/source validation for socket-triggered replay requests.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('replaySocket');
const { getMode, MODES } = require('../modeManager');
const { publishEvent } = require('../eventBus');
const assignmentService = require('../assignmentService');
const { getNickname } = require('../nicknameService');
const { loadConfig } = require('../../helpers/configLoader');

const config = loadConfig();
const discordConfig = config.discord || {};

function buildRequesterLabel(socket) {
  return getNickname(socket) || socket?.data?.user?.username || socket?.id || 'unknown';
}

function normalizeReplayTitle(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 120);
}

function normalizeIncludeSidebar(value) {
  if (typeof value === 'boolean') return value;
  return true;
}

function registerReplaySocketHooks({ tryTriggerReplay, validateSources, getDefaultWebSources }) {
  io.on('connection', (socket) => {
    const handleReplayTrigger = (payload = {}, cb = () => {}) => {
      if (getMode() === MODES.LOCKDOWN) {
        cb({ error: 'Replay disabled in lockdown', state: null });
        return;
      }
      const channelId = discordConfig?.channels?.replay || null;
      if (!channelId) {
        cb({ error: 'Replay channel not configured', state: null });
        return;
      }
      const requestedSources = Array.isArray(payload?.sources) ? payload.sources : null;
      let sources = requestedSources ? validateSources(requestedSources, socket) : [];
      if (!sources.length) {
        const assignment = assignmentService.describeAssignment(socket.id);
        sources = getDefaultWebSources(assignment, socket);
      }
      if (!sources.length) {
        cb({ error: 'No replay sources selected', state: null });
        return;
      }

      const requester = buildRequesterLabel(socket);
      const title = normalizeReplayTitle(payload?.title);
      const includeSidebar = normalizeIncludeSidebar(payload?.includeSidebar);
      const attempt = tryTriggerReplay({ by: { source: 'web', requester } });
      if (!attempt.ok) {
        cb({ error: 'Replay cooldown active', remainingMs: attempt.remainingMs, state: attempt.state });
        return;
      }

      publishEvent({
        source: 'replaySocket',
        type: 'replay.requested',
        payload: {
          channelId,
          requester,
          title,
          includeSidebar,
          sources,
          requestedBy: { socketId: socket.id },
        },
      });
      logger.info('Replay requested via web', { socketId: socket.id });
      cb({ success: true, state: attempt.state });
    };

    socket.on('replay:trigger', handleReplayTrigger);
  });
}

module.exports = {
  registerReplaySocketHooks,
};
