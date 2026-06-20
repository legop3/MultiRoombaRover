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
const { createCommandHandlers } = require('../discordBotService/commands');
const {
  buildReplayJobId,
  buildReplayTitle,
  createReplaySourceResolver,
} = require('../discordBotService/replayWorkflow');

const config = loadConfig();
const discordConfig = config.discord || {};

function isTextCommand(text) {
  const clean = String(text || '').trim();
  return clean.toLowerCase() === 'ts' || /^rs(?:\s|$)/i.test(clean);
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

function createWebReplayTextCommand(socket, replayApi) {
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

      const channelId = discordConfig?.channels?.replay || null;
      if (!channelId) {
        await message.reply({ content: 'Replay denied: replay channel is not configured.' });
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
          channelId,
          requester,
          title: '',
          includeSidebar: true,
          sources: resolved.sources || [],
          requestedBy: { socketId: socket.id },
        },
      });
      const title = buildReplayTitle({ explicitTitle: '', sources: resolved.sources || [] });
      await message.reply({ content: `Replay accepted: ${title}` });
    };
  };
}

function createChatCommandMessage({ socket, text }) {
  const nickname = buildRequesterLabel(socket);
  return {
    content: String(text || '').trim(),
    author: {
      bot: false,
      id: socket.id,
      username: nickname,
    },
    member: {
      nickname,
    },
    reply: async (payload) => {
      const replyPayload = typeof payload === 'string'
        ? { content: sanitizeMentions(payload) }
        : {
            content: sanitizeMentions(payload?.content || ''),
            options: {
              embeds: payload?.embeds || undefined,
              files: payload?.files || undefined,
            },
          };
      // Web chat does not get a private shortcut for command results. The bot
      // posts the Discord-shaped reply into the configured bridge channel, and
      // the normal bridge inbound path decides how that Discord message appears
      // in web chat.
      publishEvent({ source: 'chatCommand', type: 'discord.bridgeSend', payload: replyPayload });
      return null;
    },
  };
}

async function runChatTextCommand({ text, socket }) {
  if (!isTextCommand(text)) return false;
  // ReplayEngineV2 has startup side effects by design. Loading it lazily here
  // keeps ordinary chatService initialization from changing the service boot
  // order, while still letting `rs replay` use the existing replay pipeline.
  const replayApi = require('../replayEngineV2');
  const message = createChatCommandMessage({ socket, text });
  const commands = createCommandHandlers({
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
    config,
    createReplayTextCommand: createWebReplayTextCommand(socket, replayApi),
  });

  // Let the shared router perform normal command permission checks. Site chat
  // has already broadcast the user's command text; any command reply is posted
  // into Discord and returns to web chat through the ordinary bridge inbound path.
  try {
    await commands.handleCommand(message);
  } catch (err) {
    publishEvent({
      source: 'chatCommand',
      type: 'discord.bridgeSend',
      payload: { content: sanitizeMentions(`Command failed: ${err.message || 'unknown error'}`) },
    });
  }
  return true;
}

module.exports = {
  isTextCommand,
  runChatTextCommand,
};
