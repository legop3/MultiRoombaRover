// Discord Bot Service
// Purpose: Composes Discord client bootstrap, command routing, presence rotation, and integration/event wiring.
// Scope: Keeps the service entrypoint focused on orchestration while delegating behavior to focused modules.
const {
  Client,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const logger = require('../../globals/logger').child('discordBot');
const io = require('../../globals/io');
const { loadConfig } = require('../../helpers/configLoader');
const roverManager = require('../roverManager');
const { getRoster, lockRover, rovers } = roverManager;
const { MODES, getMode, setMode } = require('../modeManager');
const { sendExternalMessage, sendExternalTyping } = require('../chatService');
const { buildReplayVideo, getReplaySources, getDefaultDiscordSources, validateSources, tryTriggerReplay } = require('../replayEngineV2');
const { getActiveDrivers } = require('../turnService');
const { getNickname } = require('../nicknameService');
const { getGlobalObjective, setGlobalObjective, clearGlobalObjective } = require('../globalObjectiveService');
const { getAdminReason, setAdminReason, clearAdminReason } = require('../adminReasonService');
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
const { createCommandHandlers } = require('./commands');
const { createIntegrations } = require('./integrations');

const config = loadConfig();
const discordConfig = config.discord || {};
const enabled = Boolean(discordConfig.token);
const adminIds = new Set((config.admins || []).map((a) => String(a.discord_id || '').trim()).filter(Boolean));
const lockdownAdminIds = new Set((config.admins || []).filter((admin) => admin.lockdown).map((admin) => String(admin.discord_id || '').trim()).filter(Boolean));

if (!enabled) {
  logger.info('Discord bot disabled; missing token in config.discord.token');
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

const commands = createCommandHandlers({
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
});

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
  clearTypingMessage: channelIO.clearTypingMessage,
  sendTypingMessage: channelIO.sendTypingMessage,
  schedulePresenceRotation: presence.schedulePresenceRotation,
  buildReplayVideo,
});

const integrationHandlers = integrations.register();

client.on('messageCreate', async (message) => {
  try {
    await commands.handleCommand(message);
    await integrationHandlers.handleBridgeInbound(message);
  } catch (err) {
    logger.warn('Error handling Discord message', err.message);
  }
});

client.once('ready', () => {
  logger.info('Discord bot logged in', { tag: client.user?.tag });
  presence.schedulePresenceRotation();
});

client.login(discordConfig.token).catch((err) => {
  logger.error('Discord login failed', err.message);
});

module.exports = {};
