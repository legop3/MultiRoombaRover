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

function embedToText(embed) {
  const data = embed?.data || embed || {};
  const lines = [];
  if (data.title) lines.push(String(data.title));
  if (data.description) lines.push(String(data.description));
  (Array.isArray(data.fields) ? data.fields : []).forEach((field) => {
    if (!field) return;
    // Discord embeds have structured fields. Chat is plain text, so flattening
    // name/value pairs keeps the command result readable without creating any
    // new web-specific UI or payload contract.
    lines.push(`${field.name || 'Field'}\n${field.value || ''}`.trim());
  });
  if (data.footer?.text) lines.push(String(data.footer.text));
  return lines.filter(Boolean).join('\n\n');
}

function replyPayloadToText(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const parts = [];
  if (payload.content) parts.push(String(payload.content));
  (Array.isArray(payload.embeds) ? payload.embeds : []).forEach((embed) => {
    const text = embedToText(embed);
    if (text) parts.push(text);
  });
  return parts.join('\n\n').trim();
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
      sendSystemMessage(`Replay accepted: ${title}`, { nickname: 'Rover bot', bot: true });
    };
  };
}

function createChatCommandMessage({ socket, text, sendSystemMessage }) {
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
      const response = sanitizeMentions(replyPayloadToText(payload));
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
  const message = createChatCommandMessage({ socket, text, sendSystemMessage });
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
    createReplayTextCommand: createWebReplayTextCommand(socket, sendSystemMessage, replayApi),
  });

  // Let the shared router perform normal command permission checks. Returning
  // true tells chatService that the text was consumed as a command and should
  // not be broadcast as a regular user chat message.
  await commands.handleCommand(message);
  return true;
}

module.exports = {
  isTextCommand,
  runChatTextCommand,
};
