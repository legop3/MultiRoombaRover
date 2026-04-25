const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionsBitField,
  WebhookClient,
  MessageFlags,
} = require('discord.js');
const logger = require('../globals/logger').child('discordBot');
const io = require('../globals/io');
const { loadConfig } = require('../helpers/configLoader');
const { subscribe } = require('./eventBus');
const roverManager = require('./roverManager');
const { getRoster, lockRover, rovers } = roverManager;
const { MODES, getMode, setMode } = require('./modeManager');
const { sendExternalMessage, sendExternalTyping } = require('./chatService');
const { buildReplayVideo } = require('./replayBuildService');
const { getReplaySources, getDefaultDiscordSources, validateSources } = require('./replaySourceService');
const { getActiveDrivers } = require('./turnService');
const { getNickname } = require('./nicknameService');
const { tryTriggerReplay } = require('./replayService');
const { getCommunityGoal, setCommunityGoal, clearCommunityGoal } = require('./communityGoalService');
const { getAdminReason, setAdminReason, clearAdminReason } = require('./adminReasonService');
const {
  getGuildConfig,
  listGuildConfigs,
  removeGuildConfig,
  setGuildConfig,
  normalizeMode,
  VALID_MODES,
} = require('./discordGuildStore');
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
} = require('./verificationService');
const {
  DM_APPROVE_EMOJI: PRIVATE_ACCESS_APPROVE_EMOJI,
  DM_DENY_EMOJI: PRIVATE_ACCESS_DENY_EMOJI,
  attachDmMessage: attachPrivateAccessDmMessage,
  getRequestByMessageId: getPrivateAccessRequestByMessageId,
  approveRequest: approvePrivateAccessRequest,
  denyRequest: denyPrivateAccessRequest,
} = require('./privateRoverAccessRequestService');
const config = loadConfig();
const discordConfig = config.discord || {};
const enabled = Boolean(discordConfig.token);
const adminIds = new Set(
  (config.admins || []).map((a) => String(a.discord_id || '').trim()).filter(Boolean),
);
const lockdownAdminIds = new Set(
  (config.admins || [])
    .filter((admin) => admin.lockdown)
    .map((admin) => String(admin.discord_id || '').trim())
    .filter(Boolean),
);

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

const channelCache = new Map();
const typingMessageCache = new Map();
let skippedFirstModeAnnouncement = false;
const PRESENCE_ROTATE_MS = 20000;
let presenceInterval = null;
let presenceShowGoal = false;
const VERIFY_APPROVE_EMOJI = '✅';
const VERIFY_DENY_EMOJI = '❌';
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
  if (!roverManager.canReplayRoverId(record.id)) return null;
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
  const roster = getRoster().filter((entry) => roverManager.canReplayRoverId(entry.id));
  const total = roster.length;
  const ready = roster.filter((r) => !r.locked).length;
  return { ready, total };
}

function truncatePresenceText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function buildPresenceName() {
  const { ready, total } = countReady();
  const mode = getMode();
  const goal = getCommunityGoal();
  const goalText = goal?.text ? String(goal.text).trim() : '';
  if (presenceShowGoal && goalText) {
    const trimmed = truncatePresenceText(goalText, 110);
    return `Goal: ${trimmed}`;
  }
  return `${mode} · ${ready}/${total} Rovers Ready`;
}

async function updatePresence() {
  if (!client?.user) return;
  try {
    await client.user.setPresence({
      activities: [{ name: buildPresenceName(), type: ActivityType.Watching }],
      status: 'online',
    });
  } catch (err) {
    logger.warn('Failed to update Discord presence', err.message);
  }
}

function schedulePresenceRotation() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
  const goal = getCommunityGoal();
  if (!goal?.text) {
    presenceShowGoal = false;
    updatePresence();
    return;
  }
  presenceShowGoal = false;
  updatePresence();
  presenceInterval = setInterval(() => {
    presenceShowGoal = !presenceShowGoal;
    updatePresence();
  }, PRESENCE_ROTATE_MS);
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

function isLockdownAdminUser(discordId) {
  return lockdownAdminIds.has(String(discordId || '').trim());
}

function formatHelp() {
  return [
    '**Rover Bot Commands**',
    '`rs help` — show this help',
    '`rs status [id]` — show rover status (all or one)',
    '`rs replay [sources]` — send instant replay (room/rover)',
    '`rs bridge` — show chat bridge status for this server',
    '`rs bridge here <global|private>` — set chat bridge to this channel',
    '`rs bridge mode <global|private>` — change chat bridge mode',
    '`rs bridge off` — disable chat bridge for this server',
    '`rs lock <id>` — lock a rover',
    '`rs unlock <id>` — unlock a rover',
    '`rs mode <open|turns|admin|lockdown>` — change server mode',
    '`rs reason [text|clear]` — show or set admin mode reason',
    '`rs goal [text|clear]` — show or set community goal',
    '`rs verify list` — list verified users (lockdown admins)',
    '`rs verify remove <cookieUserId|nickname>` — remove verified user (lockdown admins)',
    '`rs deter list` — list deterred users (lockdown admins)',
    '`rs deter ban <cookieUserId|nickname|ip> [reason]` — deter a user (lockdown admins)',
    '`rs deter unban <id|cookieUserId|nickname|ip>` — remove deterrence (lockdown admins)',
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

function normalizeReplayQuery(input) {
  return String(input || '').trim().toLowerCase();
}

function resolveReplaySources(query) {
  const cleaned = normalizeReplayQuery(query);
  if (!cleaned || cleaned === 'all' || cleaned === '*') {
    return { sources: getDefaultDiscordSources() };
  }
  const tokens = cleaned.split(',').map((token) => token.trim()).filter(Boolean);
  const all = getReplaySources();
  const matches = [];
  tokens.forEach((token) => {
    const [prefix, rest] = token.includes(':') ? token.split(':', 2) : [null, token];
    const candidates = all.filter((entry) => {
      const matchId = String(entry.id).toLowerCase() === rest;
      const matchLabel = String(entry.label || '').toLowerCase() === rest;
      if (!matchId && !matchLabel) return false;
      if (!prefix) return true;
      return entry.type === prefix;
    });
    if (candidates.length === 1) {
      matches.push({ type: candidates[0].type, id: candidates[0].id, label: candidates[0].label });
    }
  });
  const sources = validateSources(matches);
  if (!sources.length) {
    return { error: 'No matching sources found', matches: [] };
  }
  return { sources };
}

function buildReplayCaption(requester, sources = [], missingSources = []) {
  const requesterLabel = requester || 'unknown';
  const sourceLabel = sources.length
    ? `Sources: ${sources.map((source) => source.label || `${source.type}:${source.id}`).join(', ')}.`
    : 'No sources.';
  const missingLabel = missingSources.length
    ? `Missing: ${missingSources.map((source) => source.label || `${source.type}:${source.id}`).join(', ')}.`
    : null;
  return [
    `Replay requested by ${requesterLabel}.`,
    sourceLabel,
    missingLabel,
    buildDriverCaption(),
  ]
    .filter(Boolean)
    .join(' ');
}

async function sendReplayToChannel(channelId, requester, sources = []) {
  if (!channelId) {
    throw new Error('Replay channel not configured');
  }
  const { buffer, usedSources, missingSources } = await buildReplayVideo({ sources });
  const attachment = new AttachmentBuilder(buffer, { name: 'replay.mp4' });
  const caption = buildReplayCaption(requester, usedSources, missingSources);
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
  const resolved = resolveReplaySources(query);
  if (resolved?.error) {
    await message.reply({
      content: sanitizeMentions(resolved.error),
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  const sources = resolved.sources || [];
  const requester =
    message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
  try {
    const { buffer, usedSources, missingSources } = await buildReplayVideo({ sources });
    const attachment = new AttachmentBuilder(buffer, { name: 'replay.mp4' });
    const caption = buildReplayCaption(requester, usedSources, missingSources);
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

async function handleModeCommand(message, tokens = []) {
  const next = String(tokens.shift() || '').toLowerCase();
  const reasonText = tokens.join(' ').trim();
  if (!Object.values(MODES).includes(next)) {
    await message.reply({
      content: 'Invalid mode. Use one of: open, turns, admin, lockdown.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  try {
    const role = isLockdownAdminUser(message.author?.id) ? 'lockdown' : 'admin';
    setMode(next, { data: { role, user: { username: `discord:${message.author?.username || 'unknown'}` } } });
    if (reasonText) {
      setAdminReason(reasonText, { by: message.author?.id || null });
    }
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

async function handleReasonCommand(message, tokens) {
  const query = tokens.join(' ').trim();
  const lower = query.toLowerCase();
  if (!query) {
    const reason = getAdminReason();
    const text = reason?.text ? reason.text : null;
    await message.reply({
      content: text ? `Admin mode reason: ${sanitizeMentions(text)}` : 'No admin mode reason set.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (!isAdminUser(message.author.id)) {
    await message.reply({
      content: 'Only admins can update the admin mode reason.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (lower === 'clear') {
    try {
      clearAdminReason({ by: message.author?.id || null });
      await message.reply({
        content: 'Admin mode reason cleared.',
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      await message.reply({
        content: sanitizeMentions(`Failed to clear reason: ${err.message}`),
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
    return;
  }

  try {
    setAdminReason(query, { by: message.author?.id || null });
    await message.reply({
      content: sanitizeMentions(`Admin mode reason set: ${query}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (err) {
    await message.reply({
      content: sanitizeMentions(`Failed to set reason: ${err.message}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
}

async function handleGoalCommand(message, tokens) {
  const query = tokens.join(' ').trim();
  const lower = query.toLowerCase();
  if (!query) {
    const goal = getCommunityGoal();
    const text = goal?.text ? goal.text : null;
    await message.reply({
      content: text ? `Community goal: ${sanitizeMentions(text)}` : 'No community goal set.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (!isAdminUser(message.author.id)) {
    await message.reply({
      content: 'Only admins can update the community goal.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (lower === 'clear') {
    try {
      clearCommunityGoal({ by: message.author?.id || null });
      await message.reply({
        content: 'Community goal cleared.',
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      await message.reply({
        content: sanitizeMentions(`Failed to clear goal: ${err.message}`),
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
    return;
  }

  try {
    setCommunityGoal(query, { by: message.author?.id || null });
    await message.reply({
      content: sanitizeMentions(`Community goal set: ${query}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (err) {
    await message.reply({
      content: sanitizeMentions(`Failed to set goal: ${err.message}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
}

function formatMaskedCookieKey(value) {
  const key = String(value || '').trim();
  if (!key) return 'n/a';
  if (key.length <= 10) return `${key.slice(0, 2)}***${key.slice(-2)}`;
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

async function handleVerifyCommand(message, tokens) {
  if (!isLockdownAdminUser(message.author?.id)) {
    await message.reply({
      content: 'Only lockdown admins can manage verified users.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const action = (tokens.shift() || 'list').toLowerCase();
  if (action === 'list') {
    const users = listVerifiedUsers();
    if (!users.length) {
      await message.reply({
        content: 'No verified users.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }
    const lines = users.map((entry, idx) => {
      const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'unknown';
      const ipCount = Array.isArray(entry.knownIps) ? entry.knownIps.length : 0;
      return `${idx + 1}. ${entry.nickname || 'unknown'} | ${formatMaskedCookieKey(entry.cookieUserId)} | ips:${ipCount} | updated:${updated}`;
    });
    await message.reply({
      content: ['Verified users:', ...lines].join('\n').slice(0, 1900),
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (action === 'remove') {
    const selector = tokens.join(' ').trim();
    if (!selector) {
      await message.reply({
        content: 'Usage: `rs verify remove <cookieUserId|nickname>`',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }
    try {
      const removed = removeVerifiedUser(selector, message.author?.id || null);
      await message.reply({
        content: `Removed verified user ${sanitizeMentions(removed.nickname || 'unknown')} (${formatMaskedCookieKey(removed.cookieUserId)}).`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      await message.reply({
        content: sanitizeMentions(`Failed to remove verified user: ${err.message}`),
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
    return;
  }

  await message.reply({
    content: 'Unknown verify command. Use `rs verify list` or `rs verify remove <cookieUserId|nickname>`.',
    allowedMentions: { parse: [], repliedUser: false },
  });
}

async function handleDeterCommand(message, tokens) {
  if (!isLockdownAdminUser(message.author?.id)) {
    await message.reply({
      content: 'Only lockdown admins can manage deterred users.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const action = (tokens.shift() || 'list').toLowerCase();

  if (action === 'list') {
    const users = listDeterredUsers();
    if (!users.length) {
      await message.reply({
        content: 'No deterred users.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }
    const lines = users.map((entry, idx) => {
      const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'unknown';
      const ipCount = Array.isArray(entry.knownIps) ? entry.knownIps.length : 0;
      const reason = entry.reason ? ` | reason:${entry.reason}` : '';
      return `${idx + 1}. ${entry.id} | ${entry.nickname || 'unknown'} | ${formatMaskedCookieKey(entry.cookieUserId)} | ips:${ipCount} | updated:${updated}${reason}`;
    });
    await message.reply({
      content: ['Deterred users:', ...lines].join('\n').slice(0, 1900),
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (action === 'ban') {
    const selector = String(tokens.shift() || '').trim();
    const reason = tokens.join(' ').trim();
    if (!selector) {
      await message.reply({
        content: 'Usage: `rs deter ban <cookieUserId|nickname|ip> [reason]`',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }
    try {
      const deterred = deterUser(selector, { reason, actor: message.author?.id || null });
      await message.reply({
        content: sanitizeMentions(
          `${deterred.created ? 'Deterred' : 'Updated deterrence for'} ${deterred.nickname || 'unknown'} (${formatMaskedCookieKey(deterred.cookieUserId)}).`,
        ),
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      await message.reply({
        content: sanitizeMentions(`Failed to deter user: ${err.message}`),
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
    return;
  }

  if (action === 'unban') {
    const selector = tokens.join(' ').trim();
    if (!selector) {
      await message.reply({
        content: 'Usage: `rs deter unban <id|cookieUserId|nickname|ip>`',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }
    try {
      const removed = undeterUser(selector, message.author?.id || null);
      await message.reply({
        content: sanitizeMentions(
          `Removed deterrence for ${removed.nickname || 'unknown'} (${formatMaskedCookieKey(removed.cookieUserId)}).`,
        ),
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      await message.reply({
        content: sanitizeMentions(`Failed to remove deterrence: ${err.message}`),
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
    return;
  }

  await message.reply({
    content: 'Unknown deter command. Use `rs deter list`, `rs deter ban <selector> [reason]`, or `rs deter unban <selector>`.',
    allowedMentions: { parse: [], repliedUser: false },
  });
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
  const isLockdownAdmin = isLockdownAdminUser(message.author.id);
  const isBridgeAdmin = action === 'bridge' ? canManageBridge(message) : false;
  const mode = getMode();
  const moderationActions = new Set(['lock', 'unlock', 'mode', 'goal', 'reason', 'verify', 'deter']);

  if (
    !isAdmin &&
    !isBridgeAdmin &&
    action !== '' &&
    action !== 'status' &&
    action !== 'help' &&
    action !== 'replay' &&
    action !== 'bridge' &&
    action !== 'goal' &&
    action !== 'reason' &&
    action !== 'verify' &&
    action !== 'deter'
  ) {
    return; // ignore non-admins for privileged commands
  }

  if (mode === MODES.LOCKDOWN && moderationActions.has(action) && !isLockdownAdmin) {
    await message.reply({
      content: 'Lockdown mode: only lockdown admins can run that command.',
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
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
      await handleModeCommand(message, tokens);
      break;
    case 'goal':
      await handleGoalCommand(message, tokens);
      break;
    case 'reason':
      await handleReasonCommand(message, tokens);
      break;
    case 'verify':
      await handleVerifyCommand(message, tokens);
      break;
    case 'deter':
      await handleDeterCommand(message, tokens);
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

function getTypingId(payload = {}) {
  if (payload.typingId) return payload.typingId;
  if (payload.fromDiscord) {
    if (payload.discordUserId) return `discord:${payload.discordUserId}`;
    if (payload.discordUserName) return `discord:${payload.discordUserName}`;
    if (payload.nickname) return `discord:${payload.nickname}`;
    return 'discord:unknown';
  }
  if (payload.socketId) return `socket:${payload.socketId}`;
  if (payload.nickname) return `socket:${payload.nickname}`;
  return 'socket:unknown';
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

async function sendTypingMessage(entry, payload) {
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

function buildEmbed({ title, description, color, includeSiteUrl = true }) {
  const embed = new EmbedBuilder().setTitle(title || 'Update').setColor(color || 0x2196f3);
  const siteUrl =
    includeSiteUrl && discordConfig.siteUrl ? String(discordConfig.siteUrl) : '';
  if (description) {
    embed.setDescription(siteUrl ? `${description}\n\n${siteUrl}` : description);
  } else if (siteUrl) {
    embed.setDescription(siteUrl);
  }
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
  const baseRecords = (records || Array.from(rovers.values())).filter((entry) =>
    roverManager.canReplayRoverId(entry?.id),
  );
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

function buildAllUnlockedEmbed(color, records = null) {
  const embed = buildEmbed({ title: 'All Rovers Unlocked', color: color || 0x4caf50 });
  const baseRecords = (records || Array.from(rovers.values())).filter((entry) =>
    roverManager.canReplayRoverId(entry?.id),
  );
  const snapshots = baseRecords.map(buildRoverStatusSnapshot).filter(Boolean);
  if (snapshots.length === 0) {
    embed.setDescription('No rovers online.');
    return embed;
  }
  snapshots.forEach((snapshot) => {
    const percent = snapshot?.batteryState?.percentDisplay;
    const percentLabel = percent != null ? `${percent}%` : 'n/a';
    embed.addFields({
      name: snapshot.name,
      value: `Battery: ${percentLabel}`,
      inline: true,
    });
  });
  return embed;
}

function buildAllUnlockedCaption(records = null) {
  return 'All rovers unlocked.';
}

function buildAccessModeEmbed(mode, color) {
  const visible = Array.from(rovers.values()).filter((entry) => roverManager.canReplayRoverId(entry?.id));
  const total = visible.length;
  const unlocked = visible.filter((entry) => !entry.locked).length;
  const embed = buildEmbed({
    title: 'Access Mode Updated',
    description: `Access mode set to **${mode}**\nUnlocked rovers: **${unlocked}/${total}**`,
    color: color || 0x2196f3,
  });
  return embed;
}

function buildBatteryCaption(type, payload) {
  const roverId = payload?.roverId || 'unknown';
  if (!roverManager.canReplayRoverId(roverId)) {
    return null;
  }
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

async function announce({
  channelId,
  content,
  pingRoleId,
  prefixMentions = true,
  includeSiteUrl = true,
  color,
  title,
  description,
  embeds,
  files,
}) {
  if (!channelId) return;
  const mentionChunks = [];
  if (pingRoleId) mentionChunks.push(`<@&${pingRoleId}>`);
  const prefix = prefixMentions && mentionChunks.length ? `${mentionChunks.join(' ')} ` : '';
  const payloadEmbeds =
    Array.isArray(embeds) && embeds.length > 0
      ? embeds
      : [buildEmbed({ title, description, color, includeSiteUrl })];
  const allowedMentions = {
    parse: [],
    roles: pingRoleId ? [pingRoleId] : [],
  };
  await sendToChannel(
    channelId,
    `${prefix}${content || ''}`.trim(),
    { embeds: payloadEmbeds, files: Array.isArray(files) ? files : undefined },
    allowedMentions,
    !pingRoleId, // keep mention intact when pinging
  );
}

async function announceUserStatus({ channelId, content, color, title, description, embeds }) {
  const roles = discordConfig.roles || {};
  const mode = getMode();
  const allowPing = mode !== MODES.ADMIN && mode !== MODES.LOCKDOWN;
  const pingRoleId = allowPing ? roles.announcementPing || null : null;
  const mainLine = pingRoleId ? `<@&${pingRoleId}> ${content}`.trim() : content;
  await announce({
    channelId,
    content: mainLine,
    pingRoleId,
    prefixMentions: false,
    color,
    title,
    description,
    embeds,
  });
}

function handleBusEvent(event) {
  const { type, payload } = event || {};
  const channels = discordConfig.channels || {};
  const roles = discordConfig.roles || {};
  const roverId = payload?.roverId || null;
  if (roverId && !roverManager.canReplayRoverId(roverId)) {
    return;
  }
  switch (type) {
    case 'mode.changed':
      if (!skippedFirstModeAnnouncement) {
        skippedFirstModeAnnouncement = true;
        schedulePresenceRotation();
        break;
      }
      if (payload?.mode === MODES.OPEN || payload?.mode === MODES.TURNS) {
        const caption = `Access mode set to ${payload?.mode}.`;
        announceUserStatus({
          channelId: channels.announcements,
          content: caption,
          color: 0x2196f3,
          embeds: [buildAccessModeEmbed(payload?.mode, 0x2196f3)],
        });
      }
      schedulePresenceRotation();
      break;
    case 'communityGoal.updated': {
      const goalText = payload?.text ? sanitizeMentions(String(payload.text)) : null;
      const caption = goalText ? `Community goal: ${goalText}` : 'Community goal cleared.';
      announceUserStatus({
        channelId: channels.announcements,
        content: caption,
        color: 0x8bc34a,
        title: 'Community Goal',
        description: goalText ? goalText : 'Community goal cleared.',
      });
      schedulePresenceRotation();
      break;
    }
    case 'rover.locked':
      announce({
        channelId: channels.announcements,
        color: 0xf0b651,
        title: 'Rover Locked',
        description: `${payload?.roverId} locked${payload?.reason ? ` (${payload.reason})` : ''}.`,
        includeSiteUrl: false,
      });
      schedulePresenceRotation();
      break;
    case 'rover.unlocked':
      schedulePresenceRotation();
      break;
    case 'rovers.allUnlocked':
      announceUserStatus({
        channelId: channels.announcements,
        content: buildAllUnlockedCaption(),
        color: 0x4caf50,
        embeds: [buildAllUnlockedEmbed(0x4caf50)],
      });
      schedulePresenceRotation();
      break;
    case 'rover.online':
      announce({
        channelId: channels.adminAlerts,
        pingRoleId: roles.adminPing || null,
        color: 0x4caf50,
        title: 'Rover Online',
        description: `${payload?.roverId} is online.`,
      });
      schedulePresenceRotation();
      break;
    case 'rover.offline':
      announce({
        channelId: channels.adminAlerts,
        pingRoleId: roles.adminPing || null,
        color: 0xe53935,
        title: 'Rover Offline',
        description: `${payload?.roverId} went offline.`,
      });
      schedulePresenceRotation();
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
      if (!buildBatteryCaption(type, payload)) break;
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
      if (!buildBatteryCaption(type, payload)) break;
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
      if (!buildBatteryCaption(type, payload)) break;
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
      if (!buildBatteryCaption(type, payload)) break;
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
      if (!buildBatteryCaption(type, payload)) break;
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
      if (!buildBatteryCaption(type, payload)) break;
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
      if (!buildBatteryCaption(type, payload)) break;
      announce({
        channelId: channels.adminAlerts,
        color: 0xf0b651,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0xf0b651)],
      });
      schedulePresenceRotation();
      break;
    case 'battery.unlocked':
      if (!buildBatteryCaption(type, payload)) break;
      announce({
        channelId: channels.adminAlerts,
        color: 0x4caf50,
        content: buildBatteryCaption(type, payload),
        title: 'Battery Status',
        description: null,
        embeds: [buildBatteryStatusEmbed(0x4caf50)],
      });
      schedulePresenceRotation();
      break;
    case 'replay.requested':
      sendReplayToChannel(payload?.channelId, payload?.requester, payload?.sources || []).catch((err) => {
        logger.warn('Replay send failed', err.message);
      });
      break;
    case 'humanAlert.buttonPressed': {
      const imageBase64 = payload?.imageBase64 ? String(payload.imageBase64) : '';
      let attachment = null;
      if (imageBase64) {
        try {
          const imageBuffer = Buffer.from(imageBase64, 'base64');
          if (imageBuffer.length > 0) {
            attachment = new AttachmentBuilder(imageBuffer, { name: 'human-alert-mosaic.jpg' });
          }
        } catch (err) {
          logger.warn('Failed to decode human alert image for Discord', err.message);
        }
      }
      const triggeredAt = Number(payload?.triggeredAt);
      const triggeredLabel = Number.isFinite(triggeredAt)
        ? `Triggered: <t:${Math.floor(triggeredAt / 1000)}:F>`
        : null;
      const embed = buildEmbed({
        title: 'Human Alert Button Pressed',
        description: [triggeredLabel].filter(Boolean).join('\n'),
        color: 0xe53935,
      });
      announce({
        channelId: channels.humanAlerts,
        pingRoleId: roles.humanAlertPing || null,
        content: payload?.message || 'Human alert button pressed.',
        embeds: [embed],
        files: attachment ? [attachment] : [],
        includeSiteUrl: false,
      });
      break;
    }
    case 'buttonBox.discordStalkerPing': {
      const message = payload?.message ? String(payload.message) : 'Button box chaos reward triggered.';
      const stalkerRoleId = roles.stalkerPing || null;
      const content = message;
      announce({
        channelId: channels.general,
        pingRoleId: stalkerRoleId,
        content,
        color: 0xe91e63,
        title: 'Button Box',
        description: message,
        includeSiteUrl: false,
      });
      break;
    }
    default:
      break;
  }
}

async function sendVerificationRequestDms(event) {
  const payload = event?.payload || {};
  const requestId = payload.id;
  if (!requestId) return;
  const adminIdsToNotify = Array.from(lockdownAdminIds);
  if (!adminIdsToNotify.length) {
    logger.warn('No lockdown admins configured for verification request DM', { requestId });
    return;
  }

  const createdAt = payload.createdAt ? new Date(payload.createdAt).toLocaleString() : 'unknown';
  const content = [
    '**Verification Request**',
    `Request ID: \`${requestId}\``,
    `Nickname: ${sanitizeMentions(payload.nickname || 'unknown')}`,
    `Identity key: \`${payload.cookieUserId || 'unknown'}\``,
    `IP: \`${payload.ip || 'unknown'}\``,
    `Created: ${createdAt}`,
    '',
    `React with ${VERIFY_APPROVE_EMOJI} to approve or ${VERIFY_DENY_EMOJI} to deny.`,
  ].join('\n');

  await Promise.all(
    adminIdsToNotify.map(async (adminId) => {
      try {
        const user = await client.users.fetch(String(adminId));
        if (!user) return;
        const dm = await user.createDM();
        const message = await dm.send({ content, allowedMentions: { parse: [] } });
        try {
          await message.react(VERIFY_APPROVE_EMOJI);
          await message.react(VERIFY_DENY_EMOJI);
        } catch (err) {
          logger.warn('Failed to add verification reactions', { requestId, adminId, error: err.message });
        }
        attachDmMessage(requestId, message.id, adminId);
      } catch (err) {
        logger.warn('Failed to DM lockdown admin for verification request', {
          requestId,
          adminId,
          error: err.message,
        });
      }
    }),
  );
}

async function sendPrivateRoverAccessRequestDms(event) {
  const payload = event?.payload || {};
  const requestId = payload.id;
  if (!requestId) return;
  const adminIdsToNotify = Array.from(lockdownAdminIds);
  if (!adminIdsToNotify.length) {
    logger.warn('No lockdown admins configured for private rover access request DM', { requestId });
    return;
  }
  const requester = payload.requester || {};
  const createdAt = payload.createdAt ? new Date(payload.createdAt).toLocaleString() : 'unknown';
  const content = [
    '**Private Rover Access Request**',
    `Request ID: \`${requestId}\``,
    `Rover: ${sanitizeMentions(payload.roverName || payload.roverId || 'unknown')} (\`${payload.roverId || 'unknown'}\`)`,
    `Requester: ${sanitizeMentions(requester.nickname || requester.socketId || 'unknown')}`,
    `Role: \`${requester.role || 'unknown'}\``,
    `Verified: \`${requester.isVerified ? 'yes' : 'no'}\``,
    `Identity key: \`${requester.cookieUserId || 'unknown'}\``,
    `IP: \`${requester.ip || 'unknown'}\``,
    `Created: ${createdAt}`,
    '',
    `React with ${PRIVATE_ACCESS_APPROVE_EMOJI} to approve or ${PRIVATE_ACCESS_DENY_EMOJI} to deny.`,
  ].join('\n');

  await Promise.all(
    adminIdsToNotify.map(async (adminId) => {
      try {
        const user = await client.users.fetch(String(adminId));
        if (!user) return;
        const dm = await user.createDM();
        const message = await dm.send({ content, allowedMentions: { parse: [] } });
        try {
          await message.react(PRIVATE_ACCESS_APPROVE_EMOJI);
          await message.react(PRIVATE_ACCESS_DENY_EMOJI);
        } catch (err) {
          logger.warn('Failed to add private rover access reactions', { requestId, adminId, error: err.message });
        }
        attachPrivateAccessDmMessage(requestId, message.id, adminId);
      } catch (err) {
        logger.warn('Failed to DM lockdown admin for private rover access request', {
          requestId,
          adminId,
          error: err.message,
        });
      }
    }),
  );
}

async function handleVerificationReaction(reaction, user) {
  if (!reaction || !user || user.bot) return;
  const emoji = reaction.emoji?.name;
  if (emoji !== VERIFY_APPROVE_EMOJI && emoji !== VERIFY_DENY_EMOJI) return;
  if (!isLockdownAdminUser(user.id)) return;

  const maybePartial = reaction.message?.partial || reaction.partial;
  if (maybePartial) {
    try {
      await reaction.fetch();
    } catch (err) {
      logger.warn('Failed to fetch partial reaction', err.message);
      return;
    }
  }

  const messageId = reaction.message?.id;
  if (!messageId) return;
  const linked = getRequestByMessageId(messageId);
  if (!linked?.request || linked.request.status !== 'pending') return;

  try {
    if (emoji === VERIFY_APPROVE_EMOJI) {
      approveRequest(linked.request.id, user.id);
      await reaction.message.reply({
        content: `Approved request \`${linked.request.id}\`.`,
        allowedMentions: { parse: [] },
      });
    } else {
      denyRequest(linked.request.id, user.id);
      await reaction.message.reply({
        content: `Denied request \`${linked.request.id}\`.`,
        allowedMentions: { parse: [] },
      });
    }
  } catch (err) {
    logger.warn('Failed to resolve verification request from reaction', {
      requestId: linked.request.id,
      error: err.message,
    });
  }
}

async function handlePrivateAccessReaction(reaction, user) {
  if (!reaction || !user || user.bot) return;
  const emoji = reaction.emoji?.name;
  if (emoji !== PRIVATE_ACCESS_APPROVE_EMOJI && emoji !== PRIVATE_ACCESS_DENY_EMOJI) return;
  if (!isLockdownAdminUser(user.id)) return;

  const maybePartial = reaction.message?.partial || reaction.partial;
  if (maybePartial) {
    try {
      await reaction.fetch();
    } catch (err) {
      logger.warn('Failed to fetch partial private access reaction', err.message);
      return;
    }
  }

  const messageId = reaction.message?.id;
  if (!messageId) return;
  const linked = getPrivateAccessRequestByMessageId(messageId);
  if (!linked?.request || linked.request.status !== 'pending') return;

  try {
    if (emoji === PRIVATE_ACCESS_APPROVE_EMOJI) {
      const { assignedSocketId } = approvePrivateAccessRequest(linked.request.id, user.id);
      const assignmentNote = assignedSocketId
        ? ` Granted and assigned to socket \`${assignedSocketId}\`.`
        : ' Granted.';
      await reaction.message.reply({
        content: `Approved private access request \`${linked.request.id}\`.${assignmentNote}`,
        allowedMentions: { parse: [] },
      });
    } else {
      denyPrivateAccessRequest(linked.request.id, user.id);
      await reaction.message.reply({
        content: `Denied private access request \`${linked.request.id}\`.`,
        allowedMentions: { parse: [] },
      });
    }
  } catch (err) {
    logger.warn('Failed to resolve private rover access request from reaction', {
      requestId: linked.request.id,
      error: err.message,
    });
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
  const avatarURL = payload.fromDiscord
    ? payload.discordUserAvatarUrl || null
    : client.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
  const typingId = getTypingId(payload);
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
      .then(() => {
        if (!payload.fromDiscord) {
          clearTypingMessage(entry.guildId, typingId);
        }
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
    if (payload.isTyping) {
      sendTypingMessage(entry, payload);
    } else {
      clearTypingMessage(entry.guildId, getTypingId(payload));
    }
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
  sendExternalTyping({
    nickname,
    role,
    roverId: null,
    discordGuildId: guildId,
    discordGuildName: typing?.guild?.name || null,
    discordGuildIconUrl: guildIconUrl,
    discordChannelId: channelId,
    discordUserId: user?.id || null,
    discordUserName: user?.globalName || user?.username || null,
    discordUserAvatarUrl: userAvatarUrl,
    isTyping: true,
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

client.on('typingStart', (typing) => {
  handleDiscordTypingStart(typing).catch((err) => {
    logger.warn('Error handling Discord typing', err.message);
  });
});

client.on('messageReactionAdd', (reaction, user) => {
  handleVerificationReaction(reaction, user).catch((err) => {
    logger.warn('Error handling verification reaction', err.message);
  });
  handlePrivateAccessReaction(reaction, user).catch((err) => {
    logger.warn('Error handling private access reaction', err.message);
  });
});

client.once('ready', () => {
  logger.info('Discord bot logged in', { tag: client.user?.tag });
  schedulePresenceRotation();
});

subscribe('*', handleBusEvent);
subscribe('verification.requested', sendVerificationRequestDms);
subscribe('privateRoverAccess.requested', sendPrivateRoverAccessRequestDms);
subscribe('chat:message', handleChatBridgeOutbound);
subscribe('chat:typing', handleChatTypingOutbound);

client.login(discordConfig.token).catch((err) => {
  logger.error('Discord login failed', err.message);
});

module.exports = {};
