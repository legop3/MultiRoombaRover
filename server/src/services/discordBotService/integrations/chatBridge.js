// Discord Chat Bridge Integrations
// Purpose: Bridges chat and typing between Discord and site sockets.
// Scope: Handles inbound Discord messages plus outbound webhook and typing relay.
const { WebhookClient } = require('discord.js');

function summarizeToolCall(entry = {}) {
  const tool = String(entry?.tool || 'unknown');
  const status = String(entry?.status || 'unknown').toLowerCase();
  const argsText = JSON.stringify(entry?.args && typeof entry.args === 'object' ? entry.args : {});
  if (status === 'ok') return `ok ${tool} args=${argsText}`;
  if (status === 'blocked') return `blocked ${tool} args=${argsText} - ${String(entry?.error || 'blocked')}`;
  if (status === 'error') return `error ${tool} args=${argsText} - ${String(entry?.error || 'failed')}`;
  return `unknown ${tool} args=${argsText}`;
}

function formatToolCallsCodeBlock(toolCalls = []) {
  const rows = (toolCalls || []).map((entry) => summarizeToolCall(entry));
  if (!rows.length) return '';
  return `\`\`\`txt\nTool calls:\n${rows.join('\n')}\n\`\`\``;
}

function discordPayloadToBridgeText(payload = {}) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const parts = [];
  if (payload.content) parts.push(String(payload.content));
  (Array.isArray(payload.embeds) ? payload.embeds : []).forEach((embed) => {
    const data = embed?.data || embed || {};
    const rows = [];
    if (data.title) rows.push(String(data.title));
    if (data.description) rows.push(String(data.description));
    (Array.isArray(data.fields) ? data.fields : []).forEach((field) => {
      if (!field) return;
      // The bridge stays straight-through for plain Discord content. Embeds are
      // the only Discord-specific shape that web chat cannot show directly, so
      // flatten only the readable embed text here at the bridge boundary.
      rows.push(`${field.name || 'Field'}\n${field.value || ''}`.trim());
    });
    if (data.footer?.text) rows.push(String(data.footer.text));
    if (rows.length) parts.push(rows.join('\n\n'));
  });
  (Array.isArray(payload.attachments) ? payload.attachments : []).forEach((attachment) => {
    const name = attachment?.name || attachment?.filename || 'attachment';
    const url = attachment?.url || attachment?.proxyURL || attachment?.proxyUrl || '';
    parts.push(url ? `${name}: ${url}` : String(name));
  });
  return parts.join('\n\n').trim();
}

function discordMessageToBridgeText(message) {
  const attachments = message?.attachments?.values
    ? Array.from(message.attachments.values())
    : [];
  return discordPayloadToBridgeText({
    content: message?.content || '',
    embeds: message?.embeds || [],
    attachments,
  });
}

function createChatBridgeHandlers(deps) {
  const {
    logger,
    client,
    roverManager,
    getGuildConfig,
    listGuildConfigs,
    sendToChannel,
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
    if (message.webhookId) return;
    const isRoverBotMessage = message.author?.bot && client.user?.id && String(message.author.id) === String(client.user.id);
    if (message.author.bot && !isRoverBotMessage) return;
    const content = (message.content || '').trim();
    const bridgedText = isRoverBotMessage ? discordMessageToBridgeText(message) : content;
    if (!bridgedText.trim()) return;

    const nickname = isRoverBotMessage
      ? client.user?.username || 'Rover bot'
      : message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
    const role = isAdminUser(message.author.id) ? 'admin' : 'user';
    const guildIconUrl = message.guild.iconURL?.({ extension: 'png', size: 64 }) || null;
    const userAvatarUrl = message.author.displayAvatarURL?.({ extension: 'png', size: 64 }) || null;

    try {
      sendExternalMessage({ text: bridgedText, nickname, role, roverId: null, discordGuildId: message.guild.id, discordGuildName: message.guild.name, discordGuildIconUrl: guildIconUrl, discordChannelId: message.channelId, discordUserId: message.author?.id || null, discordUserName: message.author?.globalName || message.author?.username || null, discordUserAvatarUrl: userAvatarUrl, bot: isRoverBotMessage, profileImage: isRoverBotMessage ? userAvatarUrl : null });
    } catch (err) {
      logger.warn('Failed to bridge inbound Discord chat', err.message);
    }
  }

  async function handleBridgeSendRequest(event) {
    const payload = event?.payload || {};
    const guildConfigs = listGuildConfigs();
    if (!guildConfigs.length) return;
    await Promise.all(guildConfigs.map(async (entry) => {
      if (!entry?.channelId) return;
      await sendToChannel(entry.channelId, payload.content || '', payload.options || {}, { parse: [] }, false);
    }));
  }

  function handleChatBridgeOutbound(event) {
    const payload = event?.payload;
    if (!payload) return;
    if (payload?.roverId && !roverManager.canReplayRoverId(payload.roverId)) return;
    const guildConfigs = listGuildConfigs();
    if (!guildConfigs.length) return;

    const baseText = String(payload.text || '');
    const toolCalls = Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
    const toolsBlock = formatToolCallsCodeBlock(toolCalls);
    let text = baseText;
    if (toolsBlock) {
      text = text ? `${text}\n\n${toolsBlock}` : `${toolsBlock}`;
    }
    if (text.length > 1900) text = `${text.slice(0, 1897)}...`;
    if (!text.trim()) return;
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
    handleBridgeSendRequest,
  };
}

module.exports = {
  createChatBridgeHandlers,
  discordPayloadToBridgeText,
};
