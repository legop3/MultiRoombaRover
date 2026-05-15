// Discord Bus Event Integrations
// Purpose: Handles event-bus announcements to Discord channels.
// Scope: Processes supported event types and posts formatted messages/embeds.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const io = require('../../../globals/io');
const { buildBatteryStatusEmbed, buildBatteryCaption } = require('../batteryEmbeds');

function createBusEventHandler(deps) {
  const { logger, discordConfig, getMode, MODES, roverManager, rovers, schedulePresenceRotation, formatDuration, sendToChannel, buildReplayVideo, getActiveDrivers, getNickname } = deps;
  const ADMIN_ALERT_EVENT_TYPES = new Set(['rover.online', 'rover.offline', 'rover.dockGuard', 'battery.warn', 'battery.urgent', 'battery.docked', 'battery.undocked', 'battery.charging.start', 'battery.charging.stop', 'battery.locked', 'battery.unlocked']);
  let skippedFirstModeAnnouncement = false;

  function buildEmbed({ title, description, color, includeSiteUrl = true }) {
    const embed = new EmbedBuilder().setTitle(title || 'Update').setColor(color || 0x2196f3);
    const siteUrl = includeSiteUrl && discordConfig.siteUrl ? String(discordConfig.siteUrl) : '';
    if (description) embed.setDescription(siteUrl ? `${description}\n\n${siteUrl}` : description);
    else if (siteUrl) embed.setDescription(siteUrl);
    embed.setTimestamp(new Date());
    return embed;
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
    const prefix = prefixMentions && pingRoleId ? `<@&${pingRoleId}> ` : '';
    const payloadEmbeds = Array.isArray(embeds) && embeds.length
      ? embeds
      : [buildEmbed({ title, description, color, includeSiteUrl })];
    await sendToChannel(channelId, `${prefix}${content || ''}`.trim(), { embeds: payloadEmbeds, files: Array.isArray(files) ? files : undefined }, { parse: [], roles: pingRoleId ? [pingRoleId] : [] }, !pingRoleId);
  }

  async function announceUserStatus({ channelId, content, color, title, description, embeds }) {
    const roles = discordConfig.roles || {};
    const mode = getMode();
    const allowPing = mode !== MODES.ADMIN && mode !== MODES.LOCKDOWN;
    const pingRoleId = allowPing ? roles.announcementPing || null : null;
    const mainLine = pingRoleId ? `<@&${pingRoleId}> ${content || ''}`.trim() : content;
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

  function sanitizeReplayTitleForFilename(title) {
    const cleaned = String(title || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 96);
    return cleaned || 'replay';
  }

  function buildDefaultReplayTitle(requester, sources = []) {
    const requesterLabel = String(requester || 'Someone').trim() || 'Someone';
    const roverSource = (Array.isArray(sources) ? sources : []).find((entry) => entry?.type === 'rover');
    const roverLabel = roverSource?.label || roverSource?.id || 'a rover';
    return `${requesterLabel} driving ${roverLabel}`;
  }

  function buildReplayDriverLines(requester, sources = []) {
    const activeDrivers = getActiveDrivers();
    const roverSources = (Array.isArray(sources) ? sources : []).filter((entry) => entry?.type === 'rover');
    const requestedRoverIds = new Set(roverSources.map((entry) => String(entry.id)));
    const lines = [];
    requestedRoverIds.forEach((roverId) => {
      const socketId = activeDrivers?.[roverId];
      if (!socketId) return;
      const socket = io.sockets.sockets.get(socketId);
      const nickname = getNickname(socket) || socket?.data?.user?.username || socketId;
      const record = rovers.get(roverId);
      const roverName = record?.meta?.name || record?.id || roverId;
      const isAuthor = String(nickname).toLowerCase() === String(requester || '').toLowerCase();
      lines.push(`${nickname} driving ${roverName}${isAuthor ? ' **author**' : ''}`);
    });
    return lines;
  }

  function buildDriverCaption() {
    const activeDrivers = getActiveDrivers();
    const roster = Array.from(rovers.values());
    if (!roster.length) return 'Drivers: no rovers online.';
    const entries = roster.map((record) => {
      const driverId = activeDrivers[record.id];
      if (!driverId) return `${record.meta?.name || record.id}: none`;
      const socket = io.sockets.sockets.get(driverId);
      const nickname = getNickname(socket) || socket?.data?.user?.username || driverId;
      return `${record.meta?.name || record.id}: ${nickname}`;
    });
    return `Drivers: ${entries.join(', ')}`;
  }

  function buildReplayCaption({ requester, usedSources = [], missingSources = [], title }) {
    const lines = [];
    if (title) {
      lines.push(`**${title}**`);
      lines.push('');
    }
    const driverLines = buildReplayDriverLines(requester, usedSources);
    if (driverLines.length) lines.push(...driverLines);
    if (missingSources.length) {
      if (driverLines.length) lines.push('');
      lines.push(`Missing: ${missingSources.map((source) => source.label || `${source.type}:${source.id}`).join(', ')}`);
    }
    if (!lines.length) lines.push(buildDriverCaption());
    return lines.join('\n');
  }

  async function sendReplayToChannel(channelId, requester, sources = [], explicitTitle = '', includeSidebar = true) {
    if (!channelId) throw new Error('Replay channel not configured');
    const resolvedTitle = String(explicitTitle || '').trim() || buildDefaultReplayTitle(requester, sources);
    const { buffer, usedSources = sources, missingSources = [] } = await buildReplayVideo({
      sources,
      title: resolvedTitle,
      requester,
      includeSidebar,
    });
    const attachment = new AttachmentBuilder(buffer, { name: `${sanitizeReplayTitleForFilename(resolvedTitle)}.mp4` });
    const body = buildReplayCaption({
      requester,
      usedSources,
      missingSources,
      title: resolvedTitle,
    });
    await sendToChannel(channelId, body, { files: [attachment] }, { parse: [] });
  }

  function handleReplayRequested(event) {
    const payload = event?.payload || {};
    sendReplayToChannel(
      payload?.channelId,
      payload?.requester,
      payload?.sources || [],
      payload?.title || '',
      payload?.includeSidebar !== false,
    ).catch((err) => {
      logger.warn('Replay send failed', { error: err.message });
    });
  }

  function handleBusEvent(event) {
    const { type, payload } = event || {};
    const channels = discordConfig.channels || {};
    const roles = discordConfig.roles || {};
    const roverId = payload?.roverId || null;
    if (roverId && !roverManager.canReplayRoverId(roverId) && !ADMIN_ALERT_EVENT_TYPES.has(type)) return;

    switch (type) {
      case 'mode.changed':
        if (!skippedFirstModeAnnouncement) { skippedFirstModeAnnouncement = true; schedulePresenceRotation(); break; }
        if (payload?.mode === MODES.OPEN || payload?.mode === MODES.TURNS) {
          announceUserStatus({ channelId: channels.announcements, content: `Access mode set to ${payload?.mode}.`, color: 0x2196f3, title: 'Access Mode Updated', description: `Access mode set to **${payload?.mode}**` });
        }
        schedulePresenceRotation();
        break;
      case 'globalObjective.updated':
        announceUserStatus({ channelId: channels.announcements, content: payload?.text ? `Global objective: ${payload.text}` : 'Global objective cleared.', color: 0x8bc34a, title: 'Global Objective', description: payload?.text || 'Global objective cleared.' });
        schedulePresenceRotation();
        break;
      case 'communityGoal.updated':
        announceUserStatus({ channelId: channels.announcements, content: payload?.text ? `Global objective: ${payload.text}` : 'Global objective cleared.', color: 0x8bc34a, title: 'Global Objective', description: payload?.text || 'Global objective cleared.' });
        schedulePresenceRotation();
        break;
      case 'rover.locked':
        announceUserStatus({ channelId: channels.announcements, content: `${payload?.roverId} locked${payload?.reason ? ` (${payload.reason})` : ''}.`, color: 0xf0b651, title: 'Rover Locked', description: `${payload?.roverId} locked${payload?.reason ? ` (${payload.reason})` : ''}.` });
        schedulePresenceRotation();
        break;
      case 'rover.unlocked':
        schedulePresenceRotation();
        break;
      case 'rovers.allUnlocked':
        announceUserStatus({ channelId: channels.announcements, content: 'All rovers are now unlocked.', color: 0x4caf50, title: 'All Rovers Unlocked', description: 'All rovers are now unlocked.' });
        schedulePresenceRotation();
        break;
      case 'rover.online':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0x4caf50, title: 'Rover Online', description: `${payload?.roverId} is online.` });
        schedulePresenceRotation();
        break;
      case 'rover.offline':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0xe53935, title: 'Rover Offline', description: `${payload?.roverId} went offline.` });
        schedulePresenceRotation();
        break;
      case 'rover.dockGuard':
        announce({ channelId: channels.adminAlerts, color: 0xf0b651, title: 'Dock Guard Triggered', description: `${payload?.roverId} (${payload?.reasonText || 'undocked'}) for ${formatDuration(payload?.idleMs)}.` });
        break;
      case 'battery.warn':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0xf0b651, content: buildBatteryCaption(type, rovers.get(payload?.roverId || 'unknown')), embeds: [buildBatteryStatusEmbed({ color: 0xf0b651, records: Array.from(rovers.values()) })] });
        break;
      case 'battery.urgent':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0xe53935, content: buildBatteryCaption(type, rovers.get(payload?.roverId || 'unknown')), embeds: [buildBatteryStatusEmbed({ color: 0xe53935, records: Array.from(rovers.values()) })] });
        break;
      case 'battery.docked':
      case 'battery.undocked':
      case 'battery.charging.start':
        announce({ channelId: channels.adminAlerts, color: 0x2196f3, content: buildBatteryCaption(type, rovers.get(payload?.roverId || 'unknown')), embeds: [buildBatteryStatusEmbed({ color: 0x2196f3, records: Array.from(rovers.values()) })] });
        break;
      case 'battery.charging.stop':
      case 'battery.locked':
        announce({ channelId: channels.adminAlerts, color: 0xf0b651, content: buildBatteryCaption(type, rovers.get(payload?.roverId || 'unknown')), embeds: [buildBatteryStatusEmbed({ color: 0xf0b651, records: Array.from(rovers.values()) })] });
        schedulePresenceRotation();
        break;
      case 'battery.unlocked':
        announce({ channelId: channels.adminAlerts, color: 0x4caf50, content: buildBatteryCaption(type, rovers.get(payload?.roverId || 'unknown')), embeds: [buildBatteryStatusEmbed({ color: 0x4caf50, records: Array.from(rovers.values()) })] });
        schedulePresenceRotation();
        break;
      case 'humanAlert.buttonPressed': {
        const imageBase64 = payload?.imageBase64 ? String(payload.imageBase64) : '';
        let attachment = null;
        if (imageBase64) {
          try {
            const imageBuffer = Buffer.from(imageBase64, 'base64');
            if (imageBuffer.length > 0) attachment = new AttachmentBuilder(imageBuffer, { name: 'human-alert-mosaic.jpg' });
          } catch (err) { logger.warn('Failed to decode human alert image for Discord', err.message); }
        }
        announce({
          channelId: channels.humanAlerts,
          pingRoleId: roles.humanAlertPing || null,
          content: payload?.message || 'Human alert button pressed.',
          embeds: [buildEmbed({ title: 'Human Alert Button Pressed', description: null, color: 0xe53935, includeSiteUrl: false })],
          files: attachment ? [attachment] : [],
          includeSiteUrl: false,
        });
        break;
      }
      case 'replay.requested':
        handleReplayRequested(event);
        break;
      case 'buttonBox.discordStalkerPing': {
        const message = payload?.message ? String(payload.message) : 'Button box chaos reward triggered.';
        announce({
          channelId: channels.general,
          pingRoleId: roles.stalkerPing || null,
          content: message,
          color: 0xe91e63,
          title: 'Button Box',
          description: message,
          includeSiteUrl: false,
        });
        break;
      }
      case 'buttonBox.discordPingEveryone': {
        const message = payload?.message ? String(payload.message) : 'Button box chaos reward triggered.';
        sendToChannel(
          channels.general,
          `@everyone ${message}`.trim(),
          {
            embeds: [buildEmbed({ title: 'Button Box', description: message, color: 0xff3b30, includeSiteUrl: false })],
          },
          { parse: ['everyone'] },
          false,
        );
        break;
      }
      default:
        break;
    }
  }

  return { handleBusEvent, handleReplayRequested };
}

module.exports = { createBusEventHandler };
