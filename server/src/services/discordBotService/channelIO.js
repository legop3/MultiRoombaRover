// Discord Channel IO Module
// Purpose: Centralizes Discord channel fetch/send helpers plus typing-indicator message lifecycle for bridge UX.
// Scope: Provides safe channel cache operations and typing message management without command or policy logic.
const { MessageFlags } = require('discord.js');

function createChannelIO({ client, logger, sanitizeMentions }) {
  const channelCache = new Map();
  const typingMessageCache = new Map();

  async function fetchChannel(id) {
    if (!id) return null;
    if (channelCache.has(id)) return channelCache.get(id);
    try {
      const channel = await client.channels.fetch(id);
      if (channel) {
        channelCache.set(id, channel);
        return channel;
      }
    } catch (err) {
      logger.warn('Failed to fetch Discord channel', { id, error: err.message });
    }
    return null;
  }

  async function sendToChannel(id, content, options = {}, allowedMentions = { parse: [] }, sanitizeContent = true) {
    const channel = await fetchChannel(id);
    if (!channel) return null;
    try {
      const messageContent = sanitizeContent ? sanitizeMentions(content) : content;
      // Replay uploads need the returned message so the server can extract Discord's attachment URL
      // and broadcast it to the Web UI instead of streaming video from the home server.
      return await channel.send({ content: messageContent, allowedMentions, ...options });
    } catch (err) {
      logger.warn('Failed to send Discord message', { id, error: err.message });
    }
    return null;
  }

  function typingCacheKey(guildId, typingId) {
    return `${guildId}:${typingId}`;
  }

  async function clearTypingMessage(guildId, typingId) {
    const key = typingCacheKey(guildId, typingId);
    const record = typingMessageCache.get(key);
    if (!record) return;
    typingMessageCache.delete(key);
    if (record.timeoutId) clearTimeout(record.timeoutId);
    const channel = await fetchChannel(record.channelId);
    if (!channel?.messages?.fetch) return;
    try {
      const msg = await channel.messages.fetch(record.messageId);
      await msg.delete();
    } catch (err) {
      if (err?.code !== 10008) {
        logger.warn('Failed to delete typing message', { guildId, error: err.message });
      }
    }
  }

  async function sendTypingMessage(entry, payload, formatWebhookUsername, getTypingId) {
    const typingId = getTypingId(payload);
    const key = typingCacheKey(entry.guildId, typingId);
    if (typingMessageCache.has(key)) return;
    const channel = await fetchChannel(entry.channelId);
    if (!channel?.send) return;
    const username = formatWebhookUsername(payload);
    const content = `-# *${username} is typing...*`;
    try {
      const message = await channel.send({ content, allowedMentions: { parse: [] }, flags: [MessageFlags.SuppressNotifications]});
      const timeoutId = setTimeout(() => {
        clearTypingMessage(entry.guildId, typingId);
      }, 20000);
      typingMessageCache.set(key, { channelId: entry.channelId, messageId: message.id, timeoutId });
    } catch (err) {
      logger.warn('Failed to send typing message', { guildId: entry.guildId, error: err.message });
    }
  }

  return {
    fetchChannel,
    sendToChannel,
    clearTypingMessage,
    sendTypingMessage,
  };
}

module.exports = {
  createChannelIO,
};
