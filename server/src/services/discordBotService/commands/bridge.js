// Discord Bridge Command
// Purpose: Handles chat bridge configuration/status commands per guild.
// Scope: Manages bridge channel, mode, and webhook provisioning.
const { PermissionsBitField } = require('discord.js');
const { getCommandConfig } = require('../../operatorCommandService/config');

function createBridgeCommand({ getGuildConfig, setGuildConfig, removeGuildConfig, normalizeMode, VALID_MODES, isAdminUser, config }) {
  // Error text should name the active prefix because bridge setup is one of the
  // first commands an admin runs when a bot instance joins a shared Discord.
  const { prefix: commandPrefix } = getCommandConfig(config);
  function canManageBridge(message) {
    if (isAdminUser(message.author.id)) return true;
    if (!message.guild || !message.member) return false;
    const perms = message.member.permissions;
    if (!perms) return false;
    return perms.has(PermissionsBitField.Flags.ManageGuild) || perms.has(PermissionsBitField.Flags.Administrator);
  }
  function canManageWebhooksInChannel(channel) {
    if (!channel?.guild) return false;
    const botMember = channel.guild.members?.me;
    const perms = channel.permissionsFor(botMember);
    if (!perms) return false;
    return perms.has(PermissionsBitField.Flags.ManageWebhooks);
  }
  async function ensureBridgeWebhook(channel, guildId) {
    if (!channel?.id || !guildId) return null;
    if (!canManageWebhooksInChannel(channel)) throw new Error('Missing Manage Webhooks permission in this channel.');
    const existing = getGuildConfig(guildId);
    if (existing?.channelId && String(existing.channelId) === String(channel.id) && existing?.webhookId && existing?.webhookToken) return existing;
    const webhook = await channel.createWebhook({ name: 'Rover Chat Bridge', reason: 'Rover chat bridge webhook' });
    if (!webhook?.id || !webhook?.token) throw new Error('Failed to create webhook.');
    return setGuildConfig(guildId, { channelId: channel.id, mode: existing?.mode || 'global', webhookId: webhook.id, webhookToken: webhook.token });
  }
  function status(entry) {
    if (!entry) return 'Chat bridge is not configured for this server.';
    return `Chat bridge is **${entry.mode}** in <#${entry.channelId}>.`;
  }

  return async function handleBridgeCommand(message, tokens) {
    if (!message.guild) return message.reply({ content: 'Chat bridge must be configured in a server channel.', allowedMentions: { parse: [], repliedUser: false } });
    const guildId = message.guild.id;
    let action = (tokens.shift() || 'status').toLowerCase();
    let mode = null;
    if (action === 'global' || action === 'private') { mode = action; action = 'here'; }
    else if (action === 'here' || action === 'mode') { mode = (tokens.shift() || '').toLowerCase(); }
    if (mode && !VALID_MODES.has(mode)) return message.reply({ content: 'Invalid mode. Use `global` or `private`.', allowedMentions: { parse: [], repliedUser: false } });

    if (action === 'status') return message.reply({ content: status(getGuildConfig(guildId)), allowedMentions: { parse: [], repliedUser: false } });

    // Every command below this point mutates the guild bridge configuration.
    // Keeping the authorization check in one shared gate prevents destructive
    // actions, especially bridge disable, from accidentally bypassing the same
    // Manage Server/admin requirement used by `here` and `mode`.
    if (!canManageBridge(message)) return message.reply({ content: 'You need Manage Server permissions to change the chat bridge.', allowedMentions: { parse: [], repliedUser: false } });

    if (action === 'off') { removeGuildConfig(guildId); return message.reply({ content: 'Chat bridge disabled for this server.', allowedMentions: { parse: [], repliedUser: false } }); }

    if (action === 'here') {
      try {
        const entry = await ensureBridgeWebhook(message.channel, guildId);
        if (mode) setGuildConfig(guildId, { channelId: entry.channelId, mode, webhookId: entry.webhookId, webhookToken: entry.webhookToken });
        const updated = getGuildConfig(guildId);
        return message.reply({ content: `Chat bridge set to **${updated.mode}** in <#${updated.channelId}>.`, allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        return message.reply({ content: `Failed to set chat bridge: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
      }
    }

    if (action === 'mode') {
      const current = getGuildConfig(guildId);
      if (!current?.channelId) return message.reply({ content: `No chat bridge channel set. Use \`${commandPrefix} bridge here <global|private>\` first.`, allowedMentions: { parse: [], repliedUser: false } });
      const nextMode = normalizeMode(mode, null);
      if (!VALID_MODES.has(nextMode)) return message.reply({ content: 'Invalid mode. Use `global` or `private`.', allowedMentions: { parse: [], repliedUser: false } });
      const entry = setGuildConfig(guildId, { channelId: current.channelId, mode: nextMode, webhookId: current.webhookId, webhookToken: current.webhookToken });
      return message.reply({ content: `Chat bridge mode updated to **${entry.mode}** in <#${entry.channelId}>.`, allowedMentions: { parse: [], repliedUser: false } });
    }

    return message.reply({ content: `Unknown bridge command. Try \`${commandPrefix} bridge\`.`, allowedMentions: { parse: [], repliedUser: false } });
  };
}

module.exports = { createBridgeCommand };
