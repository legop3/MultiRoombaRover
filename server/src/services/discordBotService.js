const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const logger = require('../globals/logger').child('discordBot');
const io = require('../globals/io');
const { loadConfig } = require('../helpers/configLoader');
const { subscribe } = require('./eventBus');
const { getRoster, lockRover, rovers } = require('./roverManager');
const { MODES, getMode, setMode } = require('./modeManager');
const { sendExternalMessage } = require('./chatService');
const { getRoomCameras } = require('./roomCameraService');
const {
  getRoomCameraFrames,
  getRoomCameraReplayDelayMs,
  getRoomCameraReplayFrameCount,
} = require('./roomCameraSnapshotService');
const { getActiveDrivers } = require('./turnService');
const { getNickname } = require('./nicknameService');
const { tryTriggerReplay } = require('./replayService');

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
const execFileAsync = promisify(execFile);

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
    '`rs replay` — send room camera instant replay',
    '`rs lock <id>` — lock a rover',
    '`rs unlock <id>` — unlock a rover',
    '`rs mode <open|turns|admin|lockdown>` — change server mode',
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

async function buildReplayGif() {
  const cameras = getRoomCameras();
  if (!cameras.length) {
    throw new Error('No room cameras configured');
  }
  const frames = [];
  cameras.forEach((camera) => {
    const history = getRoomCameraFrames(camera.id, getRoomCameraReplayFrameCount());
    history.forEach((entry) => {
      frames.push({ camera, buffer: entry.buffer });
    });
  });
  if (!frames.length) {
    throw new Error('No camera frames available yet');
  }
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rover-replay-'));
  try {
    for (let i = 0; i < frames.length; i += 1) {
      const filename = `frame-${String(i + 1).padStart(4, '0')}.jpg`;
      await fsp.writeFile(path.join(tmpDir, filename), frames[i].buffer);
    }
    const outPath = path.join(tmpDir, 'replay.gif');
    const delayMs = getRoomCameraReplayDelayMs();
    const fps = (1000 / delayMs).toFixed(3);
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-framerate',
      fps,
      '-i',
      'frame-%04d.jpg',
      '-vf',
      'scale=640:-1:flags=lanczos',
      '-loop',
      '0',
      outPath,
    ], { cwd: tmpDir });
    const buffer = await fsp.readFile(outPath);
    return buffer;
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn('Failed to cleanup replay temp dir', err.message);
    }
  }
}

async function handleReplayCommand(message) {
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
  const requester =
    message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
  try {
    const buffer = await buildReplayGif();
    const attachment = new AttachmentBuilder(buffer, { name: 'replay.gif' });
    const caption = [
      `Replay requested by ${requester}.`,
      buildDriverCaption(),
    ].join(' ');
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

async function handleCommand(message) {
  if (message.author.bot) return;
  const content = (message.content || '').trim();
  if (!content.toLowerCase().startsWith('rs')) return;

  const tokens = content.split(/\s+/);
  tokens.shift(); // remove prefix
  const action = (tokens.shift() || '').toLowerCase();
  const isAdmin = isAdminUser(message.author.id);

  if (!isAdmin && action !== '' && action !== 'status' && action !== 'help' && action !== 'replay') {
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
      await handleReplayCommand(message);
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
