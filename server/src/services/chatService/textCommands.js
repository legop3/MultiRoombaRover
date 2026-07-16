// Chat Text Commands
// Purpose: Lets normal site chat submit the same `rs`/`ts` server commands used by Discord.
// Scope: Adapts a socket chat message into the shared command router without adding any client-side command logic.
const io = require('../../globals/io');
const roverManager = require('../roverManager');
const { MODES, getMode, setMode } = require('../modeManager');
const { isAdmin, isLockdownAdmin } = require('../roleService');
const { getActiveDrivers } = require('../turnService');
const { getNickname } = require('../nicknameService');
const { getGlobalObjective, setGlobalObjective, clearGlobalObjective } = require('../globalObjectiveService');
const { getAdminReason, setAdminReason, clearAdminReason } = require('../adminReasonService');
const homeAssistantService = require('../homeAssistantService');
const liftService = require('../liftService');
const neatoService = require('../neatoService');
const { isFeatureEnabled } = require('../../helpers/features');
const {
  listVerifiedUsers,
  removeVerifiedUser,
  listDeterredUsers,
  deterUser,
  undeterUser,
} = require('../verificationService');
const { publishEvent } = require('../eventBus');
const assignmentService = require('../assignmentService');
const { loadConfig } = require('../../helpers/configLoader');
const { createCommandHandlers } = require('../operatorCommandService');
const { parseCommandText } = require('../operatorCommandService/config');
const { createWebTransportHandlers } = require('../operatorCommandService/webTransport');
const { commandReplyToText } = require('./commandResultFormatter');
const {
  buildReplayJobId,
  buildReplayTitle,
  createReplaySourceResolver,
} = require('../replayDeliveryService/workflow');

const config = loadConfig();
const discordConfig = config.discord || {};

function isTextCommand(text) {
  return parseCommandText(text, config).matched;
}

function sanitizeMentions(text) {
  return String(text || '')
    .replace(/<(@[!&]?\d+|#\d+)>/g, '[ping removed]')
    .replace(/@everyone/gi, '[everyone]')
    .replace(/@here/gi, '[here]');
}

function buildRequesterLabel(socket) {
  return getNickname(socket) || socket?.data?.user?.username || socket?.id || 'unknown';
}

function createWebReplayTextCommand(socket, sendSystemMessage, replayApi) {
  return function createReplayHandler({
    rovers,
    getReplaySources: getAllReplaySources,
    getDefaultDiscordSources,
    validateSources: validateReplaySources,
  }) {
    const sourceResolver = createReplaySourceResolver({
      rovers,
      getReplaySources: () => getAllReplaySources(socket),
      getDefaultDiscordSources: () => {
        const assignment = assignmentService.describeAssignment(socket.id);
        return replayApi.getDefaultWebSources(assignment, socket);
      },
      validateSources: (sources) => validateReplaySources(sources, socket),
    });

    return async function handleWebReplayCommand(message, query) {
      if (getMode() === MODES.LOCKDOWN) {
        await message.reply({ content: 'Replay denied: server is in lockdown.' });
        return;
      }

      const resolved = sourceResolver.resolve(query);
      if (resolved?.error) {
        await message.reply({ content: resolved.error });
        return;
      }

      const requester = buildRequesterLabel(socket);
      const jobId = buildReplayJobId('web-chat');
      const attempt = replayApi.tryTriggerReplay({ by: { source: 'web-chat', requester } });
      if (!attempt.ok) {
        await message.reply({ content: `Replay denied: cooldown active. Try again in ${Math.ceil(attempt.remainingMs / 1000)}s.` });
        return;
      }

      // Site chat cannot upload Discord attachments directly. Publishing the
      // same replay.requested event used by the existing web replay button keeps
      // the actual render/upload pipeline centralized while still letting chat
      // commands use the normal server-side command route.
      publishEvent({
        source: 'chatCommand',
        type: 'replay.requested',
        payload: {
          jobId,
          requester,
          title: '',
          includeSidebar: true,
          sources: resolved.sources || [],
          requestedBy: { socketId: socket.id },
        },
      });
      const title = buildReplayTitle({ explicitTitle: '', sources: resolved.sources || [] });
      sendSystemMessage(`Replay accepted: ${title}`, { nickname: 'Rover bot', bot: true });
    };
  };
}

function createChatCommandRequest({ socket, text, sendSystemMessage }) {
  const nickname = buildRequesterLabel(socket);
  return {
    content: String(text || '').trim(),
    actor: {
      bot: false,
      id: socket.id,
      label: nickname,
      isAdmin: isAdmin(socket),
      isLockdownAdmin: isLockdownAdmin(socket),
    },
    transport: 'web-chat',
    reply: async (payload) => {
      const response = sanitizeMentions(commandReplyToText(payload));
      if (!response) return null;
      return sendSystemMessage(response, { nickname: 'Rover bot', bot: true });
    },
  };
}

async function runChatTextCommand({ text, socket, sendSystemMessage }) {
  if (!isTextCommand(text)) return false;
  // ReplayEngineV2 has startup side effects by design. Loading it lazily here
  // keeps ordinary chatService initialization from changing the service boot
  // order, while still letting `rs replay` use the existing replay pipeline.
  const replayApi = require('../replayEngineV2');
  const message = createChatCommandRequest({ socket, text, sendSystemMessage });
  const commandDependencies = {
    logger: null,
    client: null,
    io,
    rovers: roverManager.rovers,
    roverManager,
    getMode,
    MODES,
    setMode,
    lockRover: roverManager.lockRover,
    getNickname,
    getActiveDrivers,
    buildReplayVideo: replayApi.buildReplayVideo,
    getReplaySources: replayApi.getReplaySources,
    getDefaultDiscordSources: () => replayApi.getDefaultWebSources(assignmentService.describeAssignment(socket.id), socket),
    validateSources: replayApi.validateSources,
    tryTriggerReplay: replayApi.tryTriggerReplay,
    getGlobalObjective,
    setGlobalObjective,
    clearGlobalObjective,
    getAdminReason,
    setAdminReason,
    clearAdminReason,
    // Web chat builds its own command-router instance for the sending socket.
    // Supplying the same Home Assistant service used by Discord keeps `rs
    // lights lock/unlock` from becoming transport-specific, and it preserves
    // the existing session update path for all connected browsers.
    homeAssistantService,
    liftService,
    neatoService,
    isFeatureEnabled,
    getGuildConfig: () => null,
    setGuildConfig: () => null,
    removeGuildConfig: () => null,
    normalizeMode: (mode) => mode,
    VALID_MODES: new Set(['global', 'private']),
    listVerifiedUsers,
    removeVerifiedUser,
    listDeterredUsers,
    deterUser,
    undeterUser,
    sanitizeMentions,
    sendToChannel: null,
    isAdminUser: (id) => String(id) === String(socket.id) && isAdmin(socket),
    isLockdownAdminUser: (id) => String(id) === String(socket.id) && isLockdownAdmin(socket),
    discordConfig,
    siteUrl: String(discordConfig.siteUrl || ''),
    config,
    createReplayTextCommand: createWebReplayTextCommand(socket, sendSystemMessage, replayApi),
  };
  commandDependencies.transportHandlers = createWebTransportHandlers(commandDependencies);
  const commands = createCommandHandlers(commandDependencies);

  // Let the shared router perform normal command permission checks. Site chat
  // has already broadcast the user's command text, so command replies become a
  // local bot chat message instead of being routed through Discord as an
  // internal transport.
  try {
    await commands.handleCommand(message);
  } catch (err) {
    sendSystemMessage(`Command failed: ${sanitizeMentions(err.message || 'unknown error')}`, { nickname: 'Rover bot', bot: true });
  }
  return true;
}

module.exports = {
  isTextCommand,
  runChatTextCommand,
};
