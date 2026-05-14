// Discord Chat Bridge Integrations
// Purpose: Bridges chat and typing between Discord and site sockets.
// Scope: Handles inbound Discord messages plus outbound webhook and typing relay.
const { WebhookClient } = require('discord.js');

function createChatBridgeHandlers(deps) {
  const {
    logger,
    client,
    roverManager,
    getGuildConfig,
    listGuildConfigs,
    sendExternalMessage,
    sendExternalTyping,
    isAdminUser,
    clearTypingMessage,
    sendTypingMessage,
    formatWebhookUsername,
    getTypingId,
  } = deps;

  async function handleBridgeInbound(message) {
    if (!message.guild) return;
    const guildConfig = getGuildConfig(message.guild.id);
    if (!guildConfig?.channelId) return;
    if (String(message.channelId) !== String(guildConfig.channelId)) return;
    if (message.author.bot) return;
    const content = (message.content || '').trim();
    const lower = content.toLowerCase();
    if (lower.startsWith('rs') || lower === 'ts' || lower.startsWith('ts ')) return;

    const nickname = message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
    const role = isAdminUser(message.author.id) ? 'admin' : 'user';
    const guildIconUrl = message.guild.iconURL?.({ extension: 'png', size: 64 }) || null;
    const userAvatarUrl = message.author.displayAvatarURL?.({ extension: 'png', size: 64 }) || null;

    try {
      sendExternalMessage({ text: content, nickname, role, roverId: null, discordGuildId: message.guild.id, discordGuildName: message.guild.name, discordGuildIconUrl: guildIconUrl, discordChannelId: message.channelId, discordUserId: message.author?.id || null, discordUserName: message.author?.globalName || message.author?.username || null, discordUserAvatarUrl: userAvatarUrl });
    } catch (err) {
      logger.warn('Failed to bridge inbound Discord chat', err.message);
    }
  }

  function handleChatBridgeOutbound(event) {
    const payload = event?.payload;
    if (!payload) return;
    if (payload?.roverId && !roverManager.canReplayRoverId(payload.roverId)) return;
    const guildConfigs = listGuildConfigs();
    if (!guildConfigs.length) return;

    const text = payload.text?.length > 1900 ? `${payload.text.slice(0, 1897)}...` : payload.text;
    const username = formatWebhookUsername(payload);
    const avatarURL = payload.profileImage || (payload.fromDiscord ? payload.discordUserAvatarUrl || null : client.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null);
    const typingId = getTypingId(payload);

    guildConfigs.forEach((entry) => {
      if (!entry?.channelId || !entry?.webhookId || !entry?.webhookToken) return;
      if (payload.fromDiscord) {
        if (payload.discordGuildId && String(payload.discordGuildId) === String(entry.guildId)) return;
        if (entry.mode === 'private') return;
      }
      const webhook = new WebhookClient({ id: entry.webhookId, token: entry.webhookToken });
      webhook.send({ content: text, username, avatarURL, allowedMentions: { parse: [] } })
        .then(() => {
          if (!payload.fromDiscord) clearTypingMessage(entry.guildId, typingId);
        })
        .catch((err) => {
          logger.warn('Failed to send webhook message', { guildId: entry.guildId, error: err.message });
        });
    });
  }

  function handleChatTypingOutbound(event) {
    const payload = event?.payload;
    if (!payload || payload.fromDiscord) return;
    if (payload?.roverId && !roverManager.canReplayRoverId(payload.roverId)) return;
    const guildConfigs = listGuildConfigs();
    if (!guildConfigs.length) return;

    guildConfigs.forEach((entry) => {
      if (!entry?.channelId) return;
      if (payload.isTyping) sendTypingMessage(entry, payload, formatWebhookUsername, getTypingId);
      else clearTypingMessage(entry.guildId, getTypingId(payload));
    });
  }

  async function handleDiscordTypingStart(typing) {
    const channelId = typing?.channelId || typing?.channel?.id || null;
    const guildId = typing?.guild?.id || typing?.channel?.guild?.id || null;
    if (!guildId || !channelId) return;
    const guildConfig = getGuildConfig(guildId);
    if (!guildConfig?.channelId) return;
    if (String(channelId) !== String(guildConfig.channelId)) return;
    const user = typing?.user || null;
    if (user?.bot) return;
    const member = typing?.member || null;
    const nickname = member?.nickname || user?.globalName || user?.username || 'Discord';
    const role = isAdminUser(user?.id) ? 'admin' : 'user';
    const guildIconUrl = typing?.guild?.iconURL?.({ extension: 'png', size: 64 }) || null;
    const userAvatarUrl = user?.displayAvatarURL?.({ extension: 'png', size: 64 }) || null;
    sendExternalTyping({ nickname, role, roverId: null, discordGuildId: guildId, discordGuildName: typing?.guild?.name || null, discordGuildIconUrl: guildIconUrl, discordChannelId: channelId, discordUserId: user?.id || null, discordUserName: user?.globalName || user?.username || null, discordUserAvatarUrl: userAvatarUrl, isTyping: true });
  }

  return {
    handleBridgeInbound,
    handleChatBridgeOutbound,
    handleChatTypingOutbound,
    handleDiscordTypingStart,
  };
}

module.exports = { createChatBridgeHandlers };
