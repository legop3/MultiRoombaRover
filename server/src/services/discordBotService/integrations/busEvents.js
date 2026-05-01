// Discord Bus Event Integrations
// Purpose: Handles event-bus announcements to Discord channels.
// Scope: Processes supported event types and posts formatted messages/embeds.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const io = require('../../../globals/io');
const { buildBatteryStatusEmbed, buildBatteryCaption } = require('../batteryEmbeds');

function createBusEventHandler(deps) {
  const { logger, discordConfig, MODES, roverManager, rovers, schedulePresenceRotation, formatDuration, sendToChannel, buildReplayVideo, getActiveDrivers, getNickname } = deps;
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


  async function announce({ channelId, content, pingRoleId, color, title, description, embeds, files }) {
    if (!channelId) return;
    const prefix = pingRoleId ? `<@&${pingRoleId}> ` : '';
    const payloadEmbeds = Array.isArray(embeds) && embeds.length ? embeds : [buildEmbed({ title, description, color })];
    await sendToChannel(channelId, `${prefix}${content || ''}`.trim(), { embeds: payloadEmbeds, files: Array.isArray(files) ? files : undefined }, { parse: [], roles: pingRoleId ? [pingRoleId] : [] }, !pingRoleId);
  }

  function sanitizeReplayTitleForFilename(title) {
    const cleaned = String(title || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 96);
    return cleaned || 'replay';
  }

  function buildDefaultReplayTitle(requester, sources = []) {
    const requesterLabel = String(requester || 'Someone').trim() || 'Someone';
    const labels = (Array.isArray(sources) ? sources : [])
      .map((entry) => String(entry?.label || entry?.id || '').trim())
      .filter(Boolean);
    if (!labels.length) return `${requesterLabel} replay`;
    if (labels.length === 1) return `${requesterLabel} replay: ${labels[0]}`;
    return `${requesterLabel} replay: ${labels.slice(0, 3).join(' + ')}`;
  }

  function buildDriverSummary(sources = []) {
    const activeDrivers = getActiveDrivers();
    const roverSources = (Array.isArray(sources) ? sources : []).filter((entry) => entry?.type === 'rover');
    const lines = [];
    roverSources.forEach((source) => {
      const roverId = String(source.id);
      const socketId = activeDrivers?.[roverId];
      if (!socketId) return;
      const socket = io.sockets.sockets.get(socketId);
      const nickname = getNickname(socket) || socket?.data?.user?.username || socketId;
      const record = rovers.get(roverId);
      const roverName = record?.meta?.name || source?.label || roverId;
      lines.push(`${nickname} → ${roverName}`);
    });
    if (!lines.length) return 'Drivers: none active for selected rover sources';
    return `Drivers: ${lines.join(' | ')}`;
  }

  async function sendReplayToChannel(channelId, requester, sources = [], explicitTitle = '', includeSidebar = true) {
    if (!channelId) throw new Error('Replay channel not configured');
    const resolvedTitle = String(explicitTitle || '').trim() || buildDefaultReplayTitle(requester, sources);
    const { buffer } = await buildReplayVideo({ sources, title: resolvedTitle, requester, includeSidebar });
    const attachment = new AttachmentBuilder(buffer, { name: `${sanitizeReplayTitleForFilename(resolvedTitle)}.mp4` });
    const summary = buildDriverSummary(sources);
    const body = [ `**${resolvedTitle}**`, summary ].filter(Boolean).join('\n');
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
          announce({ channelId: channels.announcements, content: `Access mode set to ${payload?.mode}.`, color: 0x2196f3, title: 'Access Mode Updated', description: `Access mode set to **${payload?.mode}**` });
        }
        schedulePresenceRotation();
        break;
      case 'globalObjective.updated':
        announce({ channelId: channels.announcements, content: payload?.text ? `Global objective: ${payload.text}` : 'Global objective cleared.', color: 0x8bc34a, title: 'Global Objective', description: payload?.text || 'Global objective cleared.' });
        schedulePresenceRotation();
        break;
      case 'rover.online':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0x4caf50, title: 'Rover Online', description: `${payload?.roverId} is online.` });
        break;
      case 'rover.offline':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0xe53935, title: 'Rover Offline', description: `${payload?.roverId} went offline.` });
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
        break;
      case 'battery.unlocked':
        announce({ channelId: channels.adminAlerts, color: 0x4caf50, content: buildBatteryCaption(type, rovers.get(payload?.roverId || 'unknown')), embeds: [buildBatteryStatusEmbed({ color: 0x4caf50, records: Array.from(rovers.values()) })] });
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
        announce({ channelId: channels.humanAlerts, pingRoleId: roles.humanAlertPing || null, content: payload?.message || 'Human alert button pressed.', embeds: [buildEmbed({ title: 'Human Alert Button Pressed', description: null, color: 0xe53935 })], files: attachment ? [attachment] : [] });
        break;
      }
      case 'replay.requested':
        handleReplayRequested(event);
        break;
      default:
        break;
    }
  }

  return { handleBusEvent, handleReplayRequested };
}

module.exports = { createBusEventHandler };
