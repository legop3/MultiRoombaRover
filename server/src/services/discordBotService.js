const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionsBitField,
  WebhookClient,
} = require('discord.js');
const logger = require('../globals/logger').child('discordBot');
const io = require('../globals/io');
const { loadConfig } = require('../helpers/configLoader');
const { subscribe } = require('./eventBus');
const { getRoster, lockRover, rovers } = require('./roverManager');
const { MODES, getMode, setMode } = require('./modeManager');
const { sendExternalMessage } = require('./chatService');
const { getRoomCameras, getRoomCamera } = require('./roomCameraService');
const { buildRoomCameraReplayVideo } = require('./roomCameraReplayService');
const { getActiveDrivers } = require('./turnService');
const { getNickname } = require('./nicknameService');
const { tryTriggerReplay } = require('./replayService');
const {
  getGuildConfig,
  listGuildConfigs,
  removeGuildConfig,
  setGuildConfig,
  normalizeMode,
  VALID_MODES,
} = require('./discordGuildStore');

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
let skippedFirstModeAnnouncement = false;
function sanitizeMentions(text) {
  if (!text) return '';
  return String(text)
    // strip mention tokens
    .replace(/<(@[!&]?\d+|#\d+)>/g, '[ping removed]')
    // neutralize everyone/here
    .replace(/@everyone/gi, '[everyone]')
    .replace(/@here/gi, '[here]');
}

function formatVoltage(voltageMv) {
  if (voltageMv == null) return 'n/a';
  return `${(voltageMv / 1000).toFixed(2)}V`;
}

function formatCurrent(currentMa) {
  if (currentMa == null) return 'n/a';
  // const amps = currentMa / 1000;
  return `${currentMa}mA`;
}

function formatChargeState(batteryState) {
  if (!batteryState) return 'n/a';
  const charge = batteryState.charge;
  const capacity = batteryState.capacity;
  const percent = batteryState.percentDisplay;
  const chargeText = charge != null && capacity != null ? `${charge}/${capacity}mAh` : 'n/a';
  const percentText = percent != null ? `${percent}%` : 'n/a';
  return `${chargeText} (${percentText})`;
}

function formatDockEmoji(docked) {
  return docked ? '🏠' : '🧭';
}

function formatChargeEmoji(charging) {
  return charging ? '⚡' : '🔌';
}

function formatLockEmoji(locked) {
  return locked ? '🔒' : '🔓';
}

function formatBatteryEmoji(batteryState) {
  if (batteryState?.urgentActive) return '🛑';
  if (batteryState?.warnActive) return '⚠️';
  return '🔋';
}

function formatOiEmoji(oiMode) {
  if (oiMode === 'full') return '🕹️';
  if (oiMode === 'safe') return '🧰';
  if (oiMode === 'passive') return '🟢';
  if (oiMode === 'off') return '⏹️';
  return '❔';
}

function formatDuration(ms) {
  if (ms == null) return 'n/a';
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function isCharging(sensors) {
  const label = sensors?.chargingState?.label?.toLowerCase();
  const chargingByLabel =
    label === 'waiting' || label === 'full charging' || label === 'trickle charging';
  const code = sensors?.chargingState?.code;
  const chargingByCode = code === 2 || code === 3 || code === 4;
  return chargingByLabel || chargingByCode;
}

function buildRoverStatusSnapshot(record) {
  if (!record) return null;
  const sensors = record.lastSensor?.decoded || record.lastSensor?.sensors || null;
  const docked = Boolean(sensors?.chargingSources?.homeBase);
  const charging = isCharging(sensors);
  const chargingLabel = sensors?.chargingState?.label || 'unknown';
  const oiMode = sensors?.oiMode?.label || 'unknown';
  return {
    id: record.id,
    name: record.meta?.name || record.id,
    locked: record.locked,
    lockReason: record.lockReason,
    docked,
    charging,
    chargingLabel,
    voltageMv: sensors?.voltageMv ?? null,
    currentMa: sensors?.currentMa ?? null,
    batteryState: record.batteryState,
    oiMode,
  };
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
  const mode = getMode();
  try {
    await client.user.setPresence({
      activities: [{ name: `${mode} · ${ready}/${total} Rovers Ready`, type: ActivityType.Watching }],
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

async function sendToChannel(id, content, options = {}, allowedMentions = { parse: [] }, sanitizeContent = true) {
  const channel = await fetchChannel(id);
  if (!channel) return;
  try {
    const messageContent = sanitizeContent ? sanitizeMentions(content) : content;
    await channel.send({ content: messageContent, allowedMentions, ...options });
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
    '`rs replay [camera]` — send room camera instant replay',
    '`rs bridge` — show chat bridge status for this server',
    '`rs bridge here <global|private>` — set chat bridge to this channel',
    '`rs bridge mode <global|private>` — change chat bridge mode',
    '`rs bridge off` — disable chat bridge for this server',
    '`rs lock <id>` — lock a rover',
    '`rs unlock <id>` — unlock a rover',
    '`rs mode <open|turns|admin|lockdown>` — change server mode',
    '`ts` — show time status',
  ].join('\n');
}

function findRoverRecord(id) {
  if (!id) return null;
  for (const record of rovers.values()) {
    if (String(record.id) === String(id) || String(record.meta?.name) === String(id)) {
      return record;
    }
  }
  return null;
}

async function handleStatusCommand(message, roverId) {
  const record = roverId ? findRoverRecord(roverId) : null;
  if (roverId && !record) {
    const embed = buildEmbed({ title: 'Rover Status', description: 'Unknown rover.', color: 0x2196f3 });
    await message.reply({
      embeds: [embed],
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  const records = roverId ? [record] : Array.from(rovers.values());
  const embed = buildBatteryStatusEmbed(0x2196f3, records);
  await message.reply({
    embeds: [embed],
    allowedMentions: { parse: [], repliedUser: false },
  });
}

function buildDriverCaption() {
  const activeDrivers = getActiveDrivers();
  const roster = Array.from(rovers.values());
  if (!roster.length) return 'Drivers: no rovers online.';
  const entries = roster.map((record) => {
    const driverId = activeDrivers[record.id];
    if (!driverId) {
      return `${record.meta?.name || record.id}: none`;
    }
    const socket = io.sockets.sockets.get(driverId);
    const nickname = getNickname(socket) || socket?.data?.user?.username || driverId;
    return `${record.meta?.name || record.id}: ${nickname}`;
  });
  return `Drivers: ${entries.join(', ')}`;
}

function normalizeCameraQuery(input) {
  return String(input || '').trim().toLowerCase();
}

function resolveReplayCamera(query) {
  const cleaned = normalizeCameraQuery(query);
  if (!cleaned || cleaned === 'all' || cleaned === '*') return { camera: null };
  const cameras = getRoomCameras();
  const direct = cameras.find(
    (camera) =>
      String(camera.id).toLowerCase() === cleaned ||
      String(camera.name || '').toLowerCase() === cleaned,
  );
  if (direct) return { camera: direct };
  const starts = cameras.filter(
    (camera) =>
      String(camera.id).toLowerCase().startsWith(cleaned) ||
      String(camera.name || '').toLowerCase().startsWith(cleaned),
  );
  if (starts.length === 1) return { camera: starts[0] };
  if (starts.length > 1) return { error: 'Ambiguous camera name', matches: starts };
  const includes = cameras.filter(
    (camera) =>
      String(camera.id).toLowerCase().includes(cleaned) ||
      String(camera.name || '').toLowerCase().includes(cleaned),
  );
  if (includes.length === 1) return { camera: includes[0] };
  if (includes.length > 1) return { error: 'Ambiguous camera name', matches: includes };
  return { error: 'Camera not found', matches: [] };
}

function buildReplayCaption(requester, camera) {
  const requesterLabel = requester || 'unknown';
  const cameraLabel = camera ? `Camera: ${camera.name || camera.id}.` : null;
  return [
    `Replay requested by ${requesterLabel}.`,
    cameraLabel,
    buildDriverCaption(),
  ]
    .filter(Boolean)
    .join(' ');
}

async function sendReplayToChannel(channelId, requester, cameraId = null) {
  if (!channelId) {
    throw new Error('Replay channel not configured');
  }
  const buffer = await buildRoomCameraReplayVideo({ cameraId });
  const attachment = new AttachmentBuilder(buffer, { name: 'replay.mp4' });
  const camera = cameraId ? getRoomCamera(cameraId) : null;
  const caption = buildReplayCaption(requester, camera);
  await sendToChannel(channelId, caption, { files: [attachment] }, { parse: [] });
}

async function handleReplayCommand(message, query) {
  if (getMode() === MODES.LOCKDOWN) {
    await message.reply({
      content: 'Replay is disabled while the server is in lockdown.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  const attempt = tryTriggerReplay({
    by: message.author?.id || null,
    source: 'discord',
  });
  if (!attempt.ok) {
    const remaining = Math.ceil(attempt.remainingMs / 1000);
    await message.reply({
      content: `Replay cooldown active. Try again in ${remaining}s.`,
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  const resolved = resolveReplayCamera(query);
  if (resolved?.error) {
    const matches = resolved.matches || [];
    const list = matches.length
      ? `Matches: ${matches.map((cam) => cam.name || cam.id).join(', ')}`
      : 'No matching cameras found.';
    await message.reply({
      content: sanitizeMentions(`${resolved.error}. ${list}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  const cameraId = resolved.camera?.id || null;
  const requester =
    message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
  try {
    const buffer = await buildRoomCameraReplayVideo({ cameraId });
    const attachment = new AttachmentBuilder(buffer, { name: 'replay.mp4' });
    const caption = buildReplayCaption(requester, resolved.camera || null);
    await message.reply({
      content: sanitizeMentions(caption),
      files: [attachment],
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (err) {
    logger.warn('Replay capture failed', err.message);
    await message.reply({
      content: sanitizeMentions(`Replay failed: ${err.message}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
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

function canManageBridge(message) {
  if (isAdminUser(message.author.id)) return true;
  if (!message.guild || !message.member) return false;
  const perms = message.member.permissions;
  if (!perms) return false;
  return (
    perms.has(PermissionsBitField.Flags.ManageGuild) ||
    perms.has(PermissionsBitField.Flags.Administrator)
  );
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
  if (!canManageWebhooksInChannel(channel)) {
    throw new Error('Missing Manage Webhooks permission in this channel.');
  }
  const existing = getGuildConfig(guildId);
  if (
    existing?.channelId &&
    String(existing.channelId) === String(channel.id) &&
    existing?.webhookId &&
    existing?.webhookToken
  ) {
    return existing;
  }
  const webhook = await channel.createWebhook({
    name: 'Rover Chat Bridge',
    reason: 'Rover chat bridge webhook',
  });
  if (!webhook?.id || !webhook?.token) {
    throw new Error('Failed to create webhook.');
  }
  return setGuildConfig(guildId, {
    channelId: channel.id,
    mode: existing?.mode || 'global',
    webhookId: webhook.id,
    webhookToken: webhook.token,
  });
}

function formatBridgeStatus(entry) {
  if (!entry) return 'Chat bridge is not configured for this server.';
  return `Chat bridge is **${entry.mode}** in <#${entry.channelId}>.`;
}

async function handleBridgeCommand(message, tokens) {
  if (!message.guild) {
    await message.reply({
      content: 'Chat bridge must be configured in a server channel.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  const guildId = message.guild.id;
  let action = (tokens.shift() || 'status').toLowerCase();
  let mode = null;
  if (action === 'global' || action === 'private') {
    mode = action;
    action = 'here';
  } else if (action === 'here' || action === 'mode') {
    mode = (tokens.shift() || '').toLowerCase();
  }
  if (mode && !VALID_MODES.has(mode)) {
    await message.reply({
      content: 'Invalid mode. Use `global` or `private`.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (action === 'status') {
    const entry = getGuildConfig(guildId);
    await message.reply({
      content: formatBridgeStatus(entry),
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (action === 'off') {
    removeGuildConfig(guildId);
    await message.reply({
      content: 'Chat bridge disabled for this server.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (!canManageBridge(message)) {
    await message.reply({
      content: 'You need Manage Server permissions to change the chat bridge.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (action === 'here') {
    try {
      const entry = await ensureBridgeWebhook(message.channel, guildId);
      if (mode) {
        setGuildConfig(guildId, { channelId: entry.channelId, mode, webhookId: entry.webhookId, webhookToken: entry.webhookToken });
      }
      const updated = getGuildConfig(guildId);
      await message.reply({
        content: `Chat bridge set to **${updated.mode}** in <#${updated.channelId}>.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      await message.reply({
        content: `Failed to set chat bridge: ${err.message}`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
    return;
  }

  if (action === 'mode') {
    const current = getGuildConfig(guildId);
    if (!current?.channelId) {
      await message.reply({
        content: 'No chat bridge channel set. Use `rs bridge here <global|private>` first.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }
    const nextMode = normalizeMode(mode, null);
    if (!VALID_MODES.has(nextMode)) {
      await message.reply({
        content: 'Invalid mode. Use `global` or `private`.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }
    const entry = setGuildConfig(guildId, {
      channelId: current.channelId,
      mode: nextMode,
      webhookId: current.webhookId,
      webhookToken: current.webhookToken,
    });
    await message.reply({
      content: `Chat bridge mode updated to **${entry.mode}** in <#${entry.channelId}>.`,
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  await message.reply({
    content: 'Unknown bridge command. Try `rs bridge`.',
    allowedMentions: { parse: [], repliedUser: false },
  });
}

async function handleCommand(message) {
  if (message.author.bot) return;
  const content = (message.content || '').trim();
  const lower = content.toLowerCase();
  if (lower === 'ts' || lower.startsWith('ts')) {
    await handleTimeStatusCommand(message);
    return;
  }
  if (!lower.startsWith('rs')) return;

  const tokens = content.split(/\s+/);
  tokens.shift(); // remove prefix
  const action = (tokens.shift() || '').toLowerCase();
  const isAdmin = isAdminUser(message.author.id);
  const isBridgeAdmin = action === 'bridge' ? canManageBridge(message) : false;

  if (
    !isAdmin &&
    !isBridgeAdmin &&
    action !== '' &&
    action !== 'status' &&
    action !== 'help' &&
    action !== 'replay' &&
    action !== 'bridge'
  ) {
    return; // ignore non-admins for privileged commands
  }

  switch (action) {
    case '':
      await handleStatusCommand(message, tokens[0]);
      break;
    case 'help':
      await message.reply(formatHelp());
      break;
    case 'status':
      await handleStatusCommand(message, tokens[0]);
      break;
    case 'replay':
      await handleReplayCommand(message, tokens.join(' '));
      break;
    case 'bridge':
      await handleBridgeCommand(message, tokens);
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

function formatWebhookUsername(payload) {
  const name = payload.nickname || payload.socketId?.slice(0, 6) || 'unknown';
  if (payload.fromDiscord) {
    const origin = payload.discordGuildName ? ` (From: ${payload.discordGuildName})` : '';
    const isAdmin =
      payload.role === 'admin' || payload.role === 'lockdown' || payload.role === 'lockdown-admin';
    const adminTag = isAdmin ? ' [Rover Admin]' : '';
    return `${name}${origin}${adminTag}`;
  }
  const record = payload.roverId ? rovers.get(payload.roverId) : null;
  const percent = record?.batteryState?.percentDisplay;
  const voltageMv = record?.lastSensor?.decoded?.voltageMv ?? record?.lastSensor?.sensors?.voltageMv;
  const batteryText = percent != null ? `battery ${percent}%` : null;
  const voltageText = voltageMv != null ? `voltage ${formatVoltage(voltageMv)}` : null;
  const roverText = payload.roverId ? `Rover: ${payload.roverId}` : `No rover`;
  const roleText =
    payload.role === 'admin' || payload.role === 'lockdown' || payload.role === 'lockdown-admin'
      ? 'Admin'
      : null;
  const suffix = [roverText, roleText].filter(Boolean).join(' · ');
  return suffix ? `${name} · ${suffix}` : name;
}

async function handleBridgeInbound(message) {
  if (!message.guild) return;
  const guildConfig = getGuildConfig(message.guild.id);
  if (!guildConfig?.channelId) return;
  if (String(message.channelId) !== String(guildConfig.channelId)) return;
  if (message.author.bot) return;
  const content = (message.content || '').trim();
  const lower = content.toLowerCase();
  if (lower.startsWith('rs') || lower === 'ts' || lower.startsWith('ts ')) return; // don't echo commands
  const nickname =
    message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
  const role = isAdminUser(message.author.id) ? 'admin' : 'user';
  const guildIconUrl = message.guild.iconURL?.({ extension: 'png', size: 64 }) || null;
  const userAvatarUrl = message.author.displayAvatarURL?.({ extension: 'png', size: 64 }) || null;
  try {
    sendExternalMessage({
      text: content,
      nickname,
      role,
      roverId: null,
      discordGuildId: message.guild.id,
      discordGuildName: message.guild.name,
      discordGuildIconUrl: guildIconUrl,
      discordChannelId: message.channelId,
      discordUserId: message.author?.id || null,
      discordUserName: message.author?.globalName || message.author?.username || null,
      discordUserAvatarUrl: userAvatarUrl,
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

function getServerTimezone() {
  return config.timezone || config.server?.timezone || process.env.TZ || 'America/New_York';
}

function formatTimeInZone(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date);
  } catch (err) {
    return 'n/a';
  }
}

function buildTimeStatusEmbed() {
  const serverTimezone = getServerTimezone();
  const now = new Date();
  const zones = [
    { label: 'UTC', zone: 'UTC' },
    { label: 'US Pacific', zone: 'America/Los_Angeles' },
    { label: 'US Mountain', zone: 'America/Denver' },
    { label: 'US Central', zone: 'America/Chicago' },
    { label: 'US Eastern', zone: 'America/New_York' },
    { label: 'Europe London', zone: 'Europe/London' },
    { label: 'Europe Berlin', zone: 'Europe/Berlin' },
    { label: 'Asia Kolkata', zone: 'Asia/Kolkata' },
    { label: 'Asia Shanghai', zone: 'Asia/Shanghai' },
    { label: 'Asia Tokyo', zone: 'Asia/Tokyo' },
    { label: 'Australia Sydney', zone: 'Australia/Sydney' },
    { label: 'New Zealand Auckland', zone: 'Pacific/Auckland' },
  ];

  const entries = zones.map((entry) => {
    const time = formatTimeInZone(now, entry.zone);
    const highlight =
      String(entry.zone).toLowerCase() === String(serverTimezone).toLowerCase()
        ? ' **(server local timezone)**'
        : '';
    return `${entry.label} — ${time}${highlight}`;
  });

  if (!zones.some((entry) => String(entry.zone).toLowerCase() === String(serverTimezone).toLowerCase())) {
    const time = formatTimeInZone(now, serverTimezone);
    entries.push(`Server Local — ${time} **(server local timezone)**`);
  }

  const embed = buildEmbed({
    title: 'Time Status',
    description: entries.join('\n'),
    color: 0x2196f3,
  });
  embed.setFooter({ text: `Server local timezone: ${serverTimezone}` });
  return embed;
}

async function handleTimeStatusCommand(message) {
  const embed = buildTimeStatusEmbed();
  await message.reply({
    embeds: [embed],
    allowedMentions: { parse: [], repliedUser: false },
  });
}

function buildBatteryStatusEmbed(color, records = null) {
  const embed = buildEmbed({ title: 'Rover Battery Status', color: color || 0x2196f3 });
  const baseRecords = records || Array.from(rovers.values());
  const snapshots = baseRecords.map(buildRoverStatusSnapshot).filter(Boolean);
  if (snapshots.length === 0) {
    embed.setDescription('No rovers online.');
    return embed;
  }
  snapshots.forEach((snapshot) => {
    const lockLabel = snapshot.locked
      ? `locked${snapshot.lockReason ? ` (${snapshot.lockReason})` : ''}`
      : 'unlocked';
    const dockLabel = snapshot.docked ? 'docked' : 'undocked';
    const chargingLabel = snapshot.charging ? `charging (${snapshot.chargingLabel})` : 'not charging';
    const header = [
      formatBatteryEmoji(snapshot.batteryState),
      formatDockEmoji(snapshot.docked),
      formatChargeEmoji(snapshot.charging),
      formatLockEmoji(snapshot.locked),
    ].join(' ');
    const lines = [
      `Dock: ${dockLabel}`,
      `Charging: ${chargingLabel}`,
      `Battery: ${formatChargeState(snapshot.batteryState)}`,
      `Voltage: ${formatVoltage(snapshot.voltageMv)}`,
      `Current: ${formatCurrent(snapshot.currentMa)}`,
      `OI: ${snapshot.oiMode} ${formatOiEmoji(snapshot.oiMode)}`,
      `Lock: ${lockLabel}`,
    ];
    embed.addFields({
      name: `${header} ${snapshot.name}`,
      value: lines.join('\n'),
      inline: true,
    });
  });
  return embed;
}

function buildBatteryCaption(type, payload) {
  const roverId = payload?.roverId || 'unknown';
  const record = rovers.get(roverId) || findRoverRecord(roverId);
  const snapshot = buildRoverStatusSnapshot(record);
  const base = snapshot?.name || roverId;
  const percent = snapshot?.batteryState?.percentDisplay;
  const percentLabel = percent != null ? `${percent}%` : 'n/a';
  const dockLabel = snapshot?.docked ? 'docked' : 'undocked';
  const chargingLabel = snapshot?.charging ? 'charging' : 'not charging';
  const voltage = formatVoltage(snapshot?.voltageMv ?? null);
  const current = formatCurrent(snapshot?.currentMa ?? null);
  const charge = formatChargeState(snapshot?.batteryState ?? null);
  const detail = `${dockLabel}, ${chargingLabel}, ${voltage}, ${current}, ${charge}`;

  switch (type) {
    case 'battery.warn':
      return `Battery warn: ${base} at ${percentLabel}. ${detail}`;
    case 'battery.urgent':
      return `Battery urgent: ${base} at ${percentLabel}. ${detail}`;
    case 'battery.docked':
      return `Docked: ${base}. ${detail}`;
    case 'battery.undocked':
      return `Undocked: ${base}. ${detail}`;
    case 'battery.charging.start':
      return `Charging started: ${base}. ${detail}`;
    case 'battery.charging.stop':
      return `Charging stopped: ${base}. ${detail}`;
    case 'battery.locked':
      return `Locked for charging: ${base}. ${detail}`;
    case 'battery.unlocked':
      return `Unlocked after charging: ${base}. ${detail}`;
    default:
      return `Battery update: ${base}. ${detail}`;
  }
}

async function announce({ channelId, content, pingRoleId, color, title, description, embeds }) {
  if (!channelId) return;
  const prefix = pingRoleId ? `<@&${pingRoleId}> ` : '';
  const payloadEmbeds =
    Array.isArray(embeds) && embeds.length > 0
      ? embeds
      : [buildEmbed({ title, description, color })];
  const allowedMentions = pingRoleId ? { roles: [pingRoleId], parse: [] } : { parse: [] };
  await sendToChannel(
    channelId,
    `${prefix}${content || ''}`.trim(),
    { embeds: payloadEmbeds },
    allowedMentions,
    !pingRoleId, // keep role mention intact when pinging
  );
}

function handleBusEvent(event) {
  const { type, payload } = event || {};
  const channels = discordConfig.channels || {};
  const roles = discordConfig.roles || {};
  switch (type) {
    case 'mode.changed':
      if (!skippedFirstModeAnnouncement) {
        skippedFirstModeAnnouncement = true;
        updatePresence();
        break;
      }
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
        pingRoleId: roles.announcementPing || null,
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
    case 'rover.dockGuard':
      announce({
        channelId: channels.adminAlerts,
        color: 0xf0b651,
        title: 'Dock Guard Triggered',
        description: `${payload?.roverId} (${payload?.reasonText || 'undocked'}) for ${formatDuration(
          payload?.idleMs,
        )}. Seek dock + sensor stream reissued until movement.`,
      });
      break;
    case 'battery.warn':
      announce({
        channelId: channels.adminAlerts,
        pingRoleId: roles.adminPing || null,
        color: 0xf0b651,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0xf0b651)],
      });
      break;
    case 'battery.urgent':
      announce({
        channelId: channels.adminAlerts,
        pingRoleId: roles.adminPing || null,
        color: 0xe53935,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0xe53935)],
      });
      break;
    case 'battery.docked':
      announce({
        channelId: channels.adminAlerts,
        color: 0x2196f3,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0x2196f3)],
      });
      break;
    case 'battery.undocked':
      announce({
        channelId: channels.adminAlerts,
        color: 0x2196f3,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0x2196f3)],
      });
      break;
    case 'battery.charging.start':
      announce({
        channelId: channels.adminAlerts,
        color: 0x2196f3,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0x2196f3)],
      });
      break;
    case 'battery.charging.stop':
      announce({
        channelId: channels.adminAlerts,
        color: 0xf0b651,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0xf0b651)],
      });
      break;
    case 'battery.locked':
      announce({
        channelId: channels.adminAlerts,
        color: 0xf0b651,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0xf0b651)],
      });
      updatePresence();
      break;
    case 'battery.unlocked':
      announce({
        channelId: channels.adminAlerts,
        color: 0x4caf50,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0x4caf50)],
      });
      updatePresence();
      break;
    case 'replay.requested':
      sendReplayToChannel(payload?.channelId, payload?.requester, payload?.cameraId || null).catch((err) => {
        logger.warn('Replay send failed', err.message);
      });
      break;
    default:
      break;
  }
}

function handleChatBridgeOutbound(event) {
  const payload = event?.payload;
  if (!payload) return;
  const guildConfigs = listGuildConfigs();
  if (!guildConfigs.length) return;
  const text = payload.text?.length > 1900 ? `${payload.text.slice(0, 1897)}...` : payload.text;
  const username = formatWebhookUsername(payload);
  const avatarURL = payload.fromDiscord
    ? payload.discordUserAvatarUrl || null
    : client.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
  guildConfigs.forEach((entry) => {
    if (!entry?.channelId || !entry?.webhookId || !entry?.webhookToken) return;
    if (payload.fromDiscord) {
      if (payload.discordGuildId && String(payload.discordGuildId) === String(entry.guildId)) {
        return;
      }
      if (entry.mode === 'private') return;
    }
    const webhook = new WebhookClient({ id: entry.webhookId, token: entry.webhookToken });
    webhook
      .send({
        content: text,
        username,
        avatarURL,
        allowedMentions: { parse: [] },
      })
      .catch((err) => {
        logger.warn('Failed to send webhook message', { guildId: entry.guildId, error: err.message });
      });
  });
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
