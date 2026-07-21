// Discord Bot Service
// Purpose: Composes Discord client bootstrap, command routing, presence rotation, and integration/event wiring.
// Scope: Keeps the service entrypoint focused on orchestration while delegating behavior to focused modules.
const {
  Client,
  GatewayIntentBits,
  Partials,
  AttachmentBuilder,
} = require('discord.js');
const logger = require('../../globals/logger').child('discordBot');
const io = require('../../globals/io');
const { loadConfig } = require('../../helpers/configLoader');
const { isFeatureEnabled } = require('../../helpers/features');
const { parseCommandText } = require('../operatorCommandService/config');
const roverManager = require('../roverManager');
const { getRoster, lockRover, rovers } = roverManager;
const { MODES, getMode, setMode } = require('../modeManager');
const { sendExternalMessage, sendExternalTyping } = require('../chatService');
const { commandReplyToText } = require('../chatService/commandResultFormatter');
const { buildReplayVideo, getReplaySources, getDefaultDiscordSources, validateSources, tryTriggerReplay } = require('../replayEngineV2');
const { getActiveDrivers } = require('../turnService');
const { getNickname } = require('../nicknameService');
const { getGlobalObjective, setGlobalObjective, clearGlobalObjective } = require('../globalObjectiveService');
const { getAdminReason, setAdminReason, clearAdminReason } = require('../adminReasonService');
const homeAssistantService = require('../homeAssistantService');
const liftService = require('../liftService');
const neatoService = require('../neatoService');
const {
  getGuildConfig,
  listGuildConfigs,
  removeGuildConfig,
  setGuildConfig,
  normalizeMode,
  VALID_MODES,
} = require('../discordGuildStore');
const {
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
  listVerifiedUsers,
  removeVerifiedUser,
  listDeterredUsers,
  deterUser,
  undeterUser,
} = require('../verificationService');
const {
  attachDmMessage: attachPrivateAccessDmMessage,
  getRequestByMessageId: getPrivateAccessRequestByMessageId,
  approveRequest: approvePrivateAccessRequest,
  denyRequest: denyPrivateAccessRequest,
} = require('../privateRoverAccessRequestService');
const { subscribe } = require('../eventBus');
const { createPresenceManager } = require('./presence');
const { createChannelIO } = require('./channelIO');
const { createCommandHandlers } = require('../operatorCommandService');
const { createDiscordTransportHandlers, createDiscordCommandRequest } = require('./commandAdapter');
const { createIntegrations } = require('./integrations');
const { createFleetDailyReports } = require('./fleetDailyReports');
const fleetReportService = require('../fleetReportService');
const { registerPreferredDeliveryProvider } = require('../replayDeliveryService');
const {
  DEFAULT_ALLOWED_MENTIONS,
  createReplayCaptionBuilder,
  startDiscordTypingLoop,
  buildReplayFilename,
  firstAttachmentFromMessage,
  buildDiscordReplayMediaPayload,
  buildAcceptedMessage,
  buildStatusMessage,
} = require('../replayDeliveryService/workflow');

const config = loadConfig();
const discordConfig = config.discord || {};
const enabled = isFeatureEnabled('discord');
// These normalized command names mirror the command router. Bridge-channel
// command replies are mirrored into web chat, so this entrypoint needs to know
// the configured command names before it wraps message.reply.
const adminIds = new Set((config.admins || []).map((a) => String(a.discord_id || '').trim()).filter(Boolean));
const lockdownAdminIds = new Set((config.admins || []).filter((admin) => admin.lockdown).map((admin) => String(admin.discord_id || '').trim()).filter(Boolean));

if (!enabled) {
  logger.info('Discord feature disabled or missing required token');
  return;
}

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMessageTyping,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageReactions,
  GatewayIntentBits.MessageContent,
];

const client = new Client({
  intents,
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

function sanitizeMentions(text) {
  if (!text) return '';
  return String(text)
    .replace(/<(@[!&]?\d+|#\d+)>/g, '[ping removed]')
    .replace(/@everyone/gi, '[everyone]')
    .replace(/@here/gi, '[here]');
}

function isAdminUser(discordId) {
  return adminIds.has(String(discordId || '').trim());
}

function isLockdownAdminUser(discordId) {
  return lockdownAdminIds.has(String(discordId || '').trim());
}

function countReady() {
  const roster = getRoster().filter((entry) => roverManager.canReplayRoverId(entry.id));
  const total = roster.length;
  const ready = roster.filter((r) => !r.locked).length;
  return { ready, total };
}

const channelIO = createChannelIO({
  client,
  logger,
  sanitizeMentions,
});

const presence = createPresenceManager({
  client,
  logger,
  getMode,
  getGlobalObjective,
  countReady,
});

const replayCaption = createReplayCaptionBuilder({
  io,
  rovers,
  getActiveDrivers,
  getNickname,
  sanitizeMentions,
});

// Discord is the preferred replay host only while this optional feature is
// active. The core replay delivery service owns generation and automatically
// falls back to its local media store when any operation below fails.
if (discordConfig?.channels?.replay) {
  registerPreferredDeliveryProvider({
    async begin(job) {
      const channelId = discordConfig.channels.replay;
      const progressMessage = await channelIO.sendToChannel(channelId, buildAcceptedMessage(job), {}, DEFAULT_ALLOWED_MENTIONS);
      if (!progressMessage) throw new Error('Discord replay progress message could not be sent');
      const channel = await channelIO.fetchChannel(channelId);
      return {
        channelId,
        progressMessage,
        stopTyping: startDiscordTypingLoop(channel, logger, 'web replay delivery'),
      };
    },
    async deliver({ job, context, buffer, usedSources = job.sources, missingSources = [] }) {
      const progressMessage = context?.progressMessage;
      try {
        if (progressMessage?.edit) {
          await progressMessage.edit({ content: buildStatusMessage(job, 'uploading'), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
        }
        // Every delivery path uses the job creation time, so a Discord upload
        // and a server-hosted fallback always expose the same replay filename.
        const attachment = new AttachmentBuilder(buffer, { name: buildReplayFilename(job) });
        const body = replayCaption.build({ job, usedSources, missingSources });
        const uploadMessage = await channelIO.sendToChannel(context.channelId, body, { files: [attachment] }, DEFAULT_ALLOWED_MENTIONS);
        if (!uploadMessage) throw new Error('Discord upload did not return a message');
        const media = buildDiscordReplayMediaPayload({ message: uploadMessage, attachment: firstAttachmentFromMessage(uploadMessage), job });
        if (!media) throw new Error('Discord upload did not include a replay attachment URL');
        if (progressMessage?.edit) {
          // The attachment URL is already durable once Discord returns it. A
          // cosmetic progress-edit failure must not trigger a duplicate local
          // replay or replace the successful media payload sent to clients.
          await progressMessage.edit({ content: buildStatusMessage(job, 'ready'), allowedMentions: DEFAULT_ALLOWED_MENTIONS }).catch((err) => {
            logger.warn('Discord replay uploaded but progress message update failed', { jobId: job.id, error: err.message });
          });
        }
        return media;
      } catch (err) {
        err.progressMessage = progressMessage;
        throw err;
      } finally {
        if (context?.stopTyping) context.stopTyping();
      }
    },
    async completeFallback({ context, media }) {
      const siteUrl = String(discordConfig.siteUrl || '').replace(/\/$/, '');
      const publicUrl = siteUrl ? `${siteUrl}${media.url}` : media.url;
      if (context?.progressMessage?.reply) {
        await context.progressMessage.reply({
          content: `Replay hosted by the rover server: ${publicUrl}`,
          allowedMentions: DEFAULT_ALLOWED_MENTIONS,
        });
      }
    },
  });
}

const commandDependencies = {
  logger,
  client,
  io,
  rovers,
  roverManager,
  getMode,
  MODES,
  setMode,
  lockRover,
  getNickname,
  getActiveDrivers,
  buildReplayVideo,
  getReplaySources,
  getDefaultDiscordSources,
  validateSources,
  tryTriggerReplay,
  getGlobalObjective,
  setGlobalObjective,
  clearGlobalObjective,
  getAdminReason,
  setAdminReason,
  clearAdminReason,
  // Room-light lock commands must use the same Home Assistant service instance
  // as sockets, HA button triggers, and idle/darkness policies. Passing the
  // service into the shared command router keeps Discord and mirrored web-chat
  // command behavior aligned without duplicating Home Assistant calls here.
  homeAssistantService,
  liftService,
  neatoService,
  isFeatureEnabled,
  getGuildConfig,
  setGuildConfig,
  removeGuildConfig,
  normalizeMode,
  VALID_MODES,
  listVerifiedUsers,
  removeVerifiedUser,
  listDeterredUsers,
  deterUser,
  undeterUser,
  sanitizeMentions,
  sendToChannel: channelIO.sendToChannel,
  isAdminUser,
  isLockdownAdminUser,
  discordConfig,
  config,
};
commandDependencies.transportHandlers = createDiscordTransportHandlers(commandDependencies);
const commands = createCommandHandlers(commandDependencies);

  const integrations = createIntegrations({
  logger,
  client,
  config,
  discordConfig,
  rovers,
  roverManager,
  getMode,
  MODES,
  getGlobalObjective,
  getActiveDrivers,
  getNickname,
  subscribe,
  sendExternalMessage,
  sendExternalTyping,
  getGuildConfig,
  listGuildConfigs,
  attachDmMessage,
  getRequestByMessageId,
  approveRequest,
  denyRequest,
  attachPrivateAccessDmMessage,
  getPrivateAccessRequestByMessageId,
  approvePrivateAccessRequest,
  denyPrivateAccessRequest,
  lockdownAdminIds,
  isAdminUser,
  isLockdownAdminUser,
  sendToChannel: channelIO.sendToChannel,
  fetchChannel: channelIO.fetchChannel,
  clearTypingMessage: channelIO.clearTypingMessage,
  sendTypingMessage: channelIO.sendTypingMessage,
  schedulePresenceRotation: presence.schedulePresenceRotation,
  buildReplayVideo,
  sanitizeMentions,
});

const integrationHandlers = integrations.register();

function isTextCommand(content) {
  // Both transports share this parser so command detection cannot drift from
  // the dispatcher when an installation changes its prefix.
  return parseCommandText(content, config).matched;
}

function isBridgeChannelMessage(message) {
  if (!message?.guild?.id || !message?.channelId) return false;
  const guildConfig = getGuildConfig(message.guild.id);
  return Boolean(guildConfig?.channelId && String(message.channelId) === String(guildConfig.channelId));
}

function createBridgeMirroredCommandMessage(message) {
  if (!isBridgeChannelMessage(message) || !isTextCommand(message.content)) return message;
  const originalReply = message.reply.bind(message);
  return Object.assign(Object.create(message), {
    reply: async (payload) => {
      const sent = await originalReply(payload);
      const text = sanitizeMentions(commandReplyToText(payload));
      if (text) {
        // Discord command replies are mirrored to web chat by the Discord
        // command adapter, not by the chat bridge. The bridge continues to
        // ignore bot-authored Discord messages, which prevents typing helper
        // messages and bot replies from feeding back into chat.
        sendExternalMessage({
          text,
          nickname: client.user?.username || 'Rover bot',
          role: 'admin',
          roverId: null,
          discordGuildId: message.guild.id,
          discordGuildName: message.guild.name,
          discordGuildIconUrl: message.guild.iconURL?.({ extension: 'png', size: 64 }) || null,
          discordChannelId: message.channelId,
          discordUserId: client.user?.id || null,
          discordUserName: client.user?.username || 'Rover bot',
          discordUserAvatarUrl: client.user?.displayAvatarURL?.({ extension: 'png', size: 64 }) || null,
          bot: true,
          profileImage: client.user?.displayAvatarURL?.({ extension: 'png', size: 64 }) || null,
        });
      }
      return sent;
    },
  });
}

client.on('messageCreate', async (message) => {
  try {
    await integrationHandlers.handleBridgeInbound(message);
    const commandMessage = createBridgeMirroredCommandMessage(message);
    await commands.handleCommand(createDiscordCommandRequest(commandMessage, { isAdminUser, isLockdownAdminUser }));
  } catch (err) {
    logger.warn('Error handling Discord message', err.message);
  }
});

client.once('ready', () => {
  logger.info('Discord bot logged in', { tag: client.user?.tag });
  presence.schedulePresenceRotation();
  // Discord is only a delivery consumer. Starting its scheduler after the bot
  // is ready avoids failed sends during login while the collector continues to
  // operate independently of Discord availability.
  createFleetDailyReports({
    logger,
    discordConfig,
    fleetConfig: config.fleetReports || {},
    fleetReportService,
    roverManager,
    sendToChannel: channelIO.sendToChannel,
  }).start();
});

client.login(discordConfig.token).catch((err) => {
  logger.error('Discord login failed', err.message);
});

module.exports = {};
