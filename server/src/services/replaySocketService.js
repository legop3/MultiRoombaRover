const io = require('../globals/io');
const logger = require('../globals/logger').child('replaySocket');
const { getMode, MODES } = require('./modeManager');
const { publishEvent } = require('./eventBus');
const { tryTriggerReplay } = require('./replayService');
const { getNickname } = require('./nicknameService');
const { loadConfig } = require('../helpers/configLoader');

const config = loadConfig();
const discordConfig = config.discord || {};

function buildRequesterLabel(socket) {
  return getNickname(socket) || socket?.data?.user?.username || socket?.id || 'unknown';
}

io.on('connection', (socket) => {
  socket.on('replay:trigger', (payload = {}, cb = () => {}) => {
    if (getMode() === MODES.LOCKDOWN) {
      cb({ error: 'Replay disabled in lockdown', state: null });
      return;
    }
    const channelId = discordConfig?.channels?.replay || null;
    if (!channelId) {
      cb({ error: 'Replay channel not configured', state: null });
      return;
    }
    const requester = buildRequesterLabel(socket);
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
        requestedBy: { socketId: socket.id },
      },
    });
    logger.info('Replay requested via web', { socketId: socket.id });
    cb({ success: true, state: attempt.state });
  });
});
