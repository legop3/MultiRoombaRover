const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  EmbedBuilder,
} = require('discord.js');
const logger = require('../globals/logger').child('discordBot');
const { loadConfig } = require('../helpers/configLoader');
const { subscribe } = require('./eventBus');
const { getRoster, lockRover } = require('./roverManager');
const { MODES, getMode, setMode } = require('./modeManager');
const { sendExternalMessage } = require('./chatService');

const config = loadConfig();
const discordConfig = config.discord || {};
const enabled = Boolean(discordConfig.token);
const adminIds = new Set(
  (config.admins || []).map((a) => String(a.discord_id || '').trim()).filter(Boolean),
);

if (!enabled) {
  logger.info('Discord bot disabled; missing token in config.discord.token');
  return;
}

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

const client = new Client({
  intents,
  partials: [Partials.Channel],
});

const channelCache = new Map();

function sanitizeMentions(text) {
  if (!text) return '';
  return String(text)
    // strip mention tokens
    .replace(/<(@[!&]?\d+|#\d+)>/g, '[ping removed]')
    // neutralize everyone/here
    .replace(/@everyone/gi, '[everyone]')
    .replace(/@here/gi, '[here]');
}

function formatRoverStatus(rover) {
  if (!rover) return 'Unknown rover';
  const percent = rover.batteryState?.percentDisplay;
  const battery = percent != null ? `${percent}%` : 'n/a';
  const lockLabel = rover.locked ? '🔒 locked' : '🔓 unlocked';
  return `**${rover.name || rover.id}** — ${lockLabel} — battery ${battery}`;
}

function countReady() {
  const roster = getRoster();
  const total = roster.length;
  const ready = roster.filter((r) => !r.locked).length;
  return { ready, total };
}

async function updatePresence() {
  if (!client?.user) return;
  const { ready, total } = countReady();
  try {
    await client.user.setPresence({
      activities: [{ name: `${ready}/${total} Rovers Ready`, type: ActivityType.Watching }],
      status: 'online',
    });
  } catch (err) {
    logger.warn('Failed to update Discord presence', err.message);
  }
}

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

async function sendToChannel(id, content, options = {}, allowedMentions = { parse: [] }) {
  const channel = await fetchChannel(id);
  if (!channel) return;
  try {
    await channel.send({ content: sanitizeMentions(content), allowedMentions, ...options });
  } catch (err) {
    logger.warn('Failed to send Discord message', { id, error: err.message });
  }
}

function isAdminUser(discordId) {
  return adminIds.has(String(discordId || '').trim());
}

function formatHelp() {
  return [
    '**Rover Bot Commands**',
    '`rs help` — show this help',
    '`rs status [id]` — show rover status (all or one)',
    '`rs lock <id>` — lock a rover',
    '`rs unlock <id>` — unlock a rover',
    '`rs mode <open|turns|admin|lockdown>` — change server mode',
  ].join('\n');
}

function findRover(id) {
  const roster = getRoster();
  if (!id) return null;
  return roster.find((r) => String(r.id) === String(id) || String(r.name) === String(id));
}

async function handleStatusCommand(message, roverId) {
  const roster = getRoster();
  if (!roverId) {
    const summary = roster.map((r) => formatRoverStatus(r)).join('\n') || 'No rovers online.';
    await message.reply({
      content: sanitizeMentions(summary.slice(0, 1900)),
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  const rover = findRover(roverId);
  await message.reply({
    content: sanitizeMentions(formatRoverStatus(rover).slice(0, 1900)),
    allowedMentions: { parse: [], repliedUser: false },
  });
}

async function handleLockCommand(message, roverId, locked) {
  if (!roverId) {
    await message.reply({
      content: 'Specify a rover ID. Example: `rs lock alpha`',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  try {
    lockRover(roverId, locked, { reason: 'discord' });
    await message.reply({
      content: sanitizeMentions(`${locked ? 'Locked' : 'Unlocked'} ${roverId}.`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (err) {
    await message.reply({
      content: sanitizeMentions(`Failed: ${err.message}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
}

async function handleModeCommand(message, mode) {
  const next = String(mode || '').toLowerCase();
  if (!Object.values(MODES).includes(next)) {
    await message.reply({
      content: 'Invalid mode. Use one of: open, turns, admin, lockdown.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  try {
    setMode(next, null, { force: true });
    await message.reply({
      content: sanitizeMentions(`Mode set to ${next}.`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (err) {
    await message.reply({
      content: sanitizeMentions(`Failed to set mode: ${err.message}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
}

async function handleCommand(message) {
  if (message.author.bot) return;
  const content = (message.content || '').trim();
  if (!content.toLowerCase().startsWith('rs')) return;
  if (!isAdminUser(message.author.id)) {
    return; // ignore non-admins
  }

  const tokens = content.split(/\s+/);
  tokens.shift(); // remove prefix
  const action = (tokens.shift() || '').toLowerCase();

  switch (action) {
    case 'help':
      await message.reply(formatHelp());
      break;
    case 'status':
      await handleStatusCommand(message, tokens[0]);
      break;
    case 'lock':
      await handleLockCommand(message, tokens[0], true);
      break;
    case 'unlock':
      await handleLockCommand(message, tokens[0], false);
      break;
    case 'mode':
      await handleModeCommand(message, tokens[0]);
      break;
    default:
      await message.reply(formatHelp());
      break;
  }
}

function formatChatLine(payload) {
  const name = payload.nickname || payload.socketId?.slice(0, 6) || 'unknown';
  const rover = payload.roverId ? `**[${payload.roverId}]** ` : '';
  const role =
    payload.role === 'admin' || payload.role === 'lockdown' ? '**(admin)** ' : '';
  return `${rover}${role}${name}: ${payload.text}`;
}

async function handleBridgeInbound(message) {
  const bridgeChannelId = discordConfig?.channels?.chatBridge;
  if (!bridgeChannelId) return;
  if (String(message.channelId) !== String(bridgeChannelId)) return;
  if (message.author.bot) return;
  const content = (message.content || '').trim();
  if (content.toLowerCase().startsWith('rs')) return; // don't echo commands
  const nickname =
    message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
  const role = isAdminUser(message.author.id) ? 'admin' : 'user';
  try {
    sendExternalMessage({
      text: content,
      nickname,
      role,
      roverId: null,
    });
  } catch (err) {
    logger.warn('Failed to bridge inbound Discord chat', err.message);
  }
}

function buildEmbed({ title, description, color }) {
  const embed = new EmbedBuilder().setTitle(title || 'Update').setColor(color || 0x2196f3);
  if (description) embed.setDescription(description);
  embed.setTimestamp(new Date());
  return embed;
}

async function announce({ channelId, content, pingRoleId, color, title, description }) {
  if (!channelId) return;
  const prefix = pingRoleId ? `<@&${pingRoleId}> ` : '';
  const embed = buildEmbed({ title, description, color });
  const allowedMentions = pingRoleId ? { roles: [pingRoleId], parse: [] } : { parse: [] };
  await sendToChannel(channelId, `${prefix}${content || ''}`.trim(), { embeds: [embed] }, allowedMentions);
}

function handleBusEvent(event) {
  const { type, payload } = event || {};
  const channels = discordConfig.channels || {};
  const roles = discordConfig.roles || {};
  switch (type) {
    case 'mode.changed':
      announce({
        channelId: channels.announcements,
        pingRoleId: roles.announcementPing || null,
        color: 0x2196f3,
        title: 'Mode Changed',
        description: `Server mode set to **${payload?.mode}**`,
      });
      updatePresence();
      break;
    case 'rover.locked':
      announce({
        channelId: channels.announcements,
        color: 0xf0b651,
        title: 'Rover Locked',
        description: `${payload?.roverId} locked${payload?.reason ? ` (${payload.reason})` : ''}.`,
      });
      updatePresence();
      break;
    case 'rover.unlocked':
      announce({
        channelId: channels.announcements,
        color: 0x4caf50,
        title: 'Rover Unlocked',
        description: `${payload?.roverId} unlocked.`,
      });
      updatePresence();
      break;
    case 'rover.online':
      announce({
        channelId: channels.adminAlerts,
        pingRoleId: roles.adminPing || null,
        color: 0x4caf50,
        title: 'Rover Online',
        description: `${payload?.roverId} is online.`,
      });
      updatePresence();
      break;
    case 'rover.offline':
      announce({
        channelId: channels.adminAlerts,
        pingRoleId: roles.adminPing || null,
        color: 0xe53935,
        title: 'Rover Offline',
        description: `${payload?.roverId} went offline.`,
      });
      updatePresence();
      break;
    case 'battery.warn':
      announce({
        channelId: channels.adminAlerts,
        pingRoleId: roles.adminPing || null,
        color: 0xf0b651,
        title: 'Battery Warn',
        description: `${payload?.roverId} at ${payload?.batteryState?.percentDisplay ?? 'low'}%.`,
      });
      break;
    case 'battery.urgent':
      announce({
        channelId: channels.adminAlerts,
        pingRoleId: roles.adminPing || null,
        color: 0xe53935,
        title: 'Battery Urgent',
        description: `${payload?.roverId} at ${payload?.batteryState?.percentDisplay ?? 'urgent'}%.`,
      });
      break;
    case 'battery.docked':
      announce({
        channelId: channels.adminAlerts,
        color: 0x2196f3,
        title: 'Docked',
        description: `${payload?.roverId} docked.`,
      });
      break;
    case 'battery.undocked':
      announce({
        channelId: channels.adminAlerts,
        color: 0x2196f3,
        title: 'Undocked',
        description: `${payload?.roverId} undocked.`,
      });
      break;
    case 'battery.charging.start':
      announce({
        channelId: channels.adminAlerts,
        color: 0x2196f3,
        title: 'Charging Started',
        description: `${payload?.roverId} started charging.`,
      });
      break;
    case 'battery.charging.stop':
      announce({
        channelId: channels.adminAlerts,
        color: 0xf0b651,
        title: 'Charging Stopped',
        description: `${payload?.roverId} stopped charging.`,
      });
      break;
    case 'battery.locked':
      announce({
        channelId: channels.adminAlerts,
        color: 0xf0b651,
        title: 'Locked for Charging',
        description: `${payload?.roverId} locked for charging.`,
      });
      updatePresence();
      break;
    case 'battery.unlocked':
      announce({
        channelId: channels.adminAlerts,
        color: 0x4caf50,
        title: 'Unlocked after Charging',
        description: `${payload?.roverId} unlocked after charging.`,
      });
      updatePresence();
      break;
    default:
      break;
  }
}

function handleChatBridgeOutbound(event) {
  const payload = event?.payload;
  if (!payload || payload.fromDiscord) return;
  const bridgeChannelId = discordConfig?.channels?.chatBridge;
  if (!bridgeChannelId) return;
  const line = formatChatLine(payload);
  const text = line.length > 1900 ? `${line.slice(0, 1897)}...` : line;
  sendToChannel(bridgeChannelId, text, {}, { parse: [] });
}

client.on('messageCreate', async (message) => {
  try {
    await handleCommand(message);
    await handleBridgeInbound(message);
  } catch (err) {
    logger.warn('Error handling Discord message', err.message);
  }
});

client.once('ready', () => {
  logger.info('Discord bot logged in', { tag: client.user?.tag });
  updatePresence();
});

subscribe('*', handleBusEvent);
subscribe('chat:message', handleChatBridgeOutbound);

client.login(discordConfig.token).catch((err) => {
  logger.error('Discord login failed', err.message);
});

module.exports = {};
