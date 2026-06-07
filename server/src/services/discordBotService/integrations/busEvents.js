// Discord Bus Event Integrations
// Purpose: Handles event-bus announcements to Discord channels.
// Scope: Processes supported event types and posts formatted messages/embeds.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const io = require('../../../globals/io');
const { buildBatteryStatusEmbed, buildBatteryCaption } = require('../batteryEmbeds');
const {
  DEFAULT_ALLOWED_MENTIONS,
  createReplayJob,
  createJobStatusEmitter,
  createReplayCaptionBuilder,
  startDiscordTypingLoop,
  sanitizeReplayTitleForFilename,
  firstAttachmentFromMessage,
  buildDiscordReplayMediaPayload,
  buildAcceptedMessage,
  buildStatusMessage,
  normalizeUserError,
} = require('../replayWorkflow');

function createBusEventHandler(deps) {
  const { logger, discordConfig, roverManager, rovers, schedulePresenceRotation, formatDuration, sendToChannel, fetchChannel, buildReplayVideo, getActiveDrivers, getNickname, sanitizeMentions } = deps;
  const ADMIN_ALERT_EVENT_TYPES = new Set(['rover.online', 'rover.offline', 'rover.dockGuard', 'battery.warn', 'battery.urgent', 'battery.docked', 'battery.undocked', 'battery.charging.start', 'battery.charging.stop', 'battery.locked', 'battery.unlocked']);
  let skippedFirstModeAnnouncement = false;
  const jobStatus = createJobStatusEmitter({ io, logger, sanitizeMentions });
  const replayCaption = createReplayCaptionBuilder({ io, rovers, getActiveDrivers, getNickname, sanitizeMentions });

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

  async function sendReplayToChannel(channelId, requester, sources = [], explicitTitle = '', includeSidebar = true, jobId = null) {
    if (!channelId) throw new Error('Replay channel not configured');
    const job = createReplayJob({
      id: jobId,
      requester,
      source: 'web',
      title: explicitTitle,
      sources,
      includeSidebar,
    });
    jobStatus.emit(job, 'accepted', { message: buildAcceptedMessage(job) });
    const progressMessage = await sendToChannel(channelId, buildAcceptedMessage(job), {}, DEFAULT_ALLOWED_MENTIONS);
    const channel = await fetchChannel(channelId);
    const stopTyping = startDiscordTypingLoop(channel, logger, 'web replay delivery');
    try {
      jobStatus.emit(job, 'building', { message: buildStatusMessage(job, 'building') });
      if (progressMessage?.edit) await progressMessage.edit({ content: buildStatusMessage(job, 'building'), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
      const { buffer, usedSources = job.sources, missingSources = [] } = await buildReplayVideo({
        sources: job.sources,
        title: job.title,
        requester: job.requester,
        includeSidebar: job.includeSidebar,
      });
      jobStatus.emit(job, 'uploading', { message: buildStatusMessage(job, 'uploading') });
      if (progressMessage?.edit) await progressMessage.edit({ content: buildStatusMessage(job, 'uploading'), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
      const attachment = new AttachmentBuilder(buffer, { name: `${sanitizeReplayTitleForFilename(job.title)}.mp4` });
      const body = replayCaption.build({ job, usedSources, missingSources });
      const uploadMessage = await sendToChannel(channelId, body, { files: [attachment] }, DEFAULT_ALLOWED_MENTIONS);
      if (!uploadMessage) throw new Error('Discord upload did not return a message');
      const uploadedAttachment = firstAttachmentFromMessage(uploadMessage);
      const media = buildDiscordReplayMediaPayload({ message: uploadMessage, attachment: uploadedAttachment, job });
      if (!media) throw new Error('Discord upload did not include a replay attachment URL');
      jobStatus.emit(job, 'ready', { message: buildStatusMessage(job, 'ready'), media });
      if (progressMessage?.edit) await progressMessage.edit({ content: buildStatusMessage(job, 'ready'), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
    } catch (err) {
      const message = normalizeUserError(err);
      jobStatus.emit(job, 'failed', { message });
      if (progressMessage?.edit) await progressMessage.edit({ content: sanitizeMentions(message), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
      throw err;
    } finally {
      stopTyping();
    }
  }

  function handleReplayRequested(event) {
    const payload = event?.payload || {};
    sendReplayToChannel(
      payload?.channelId,
      payload?.requester,
      payload?.sources || [],
      payload?.title || '',
      payload?.includeSidebar !== false,
      payload?.jobId || null,
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
        schedulePresenceRotation();
        break;
      case 'globalObjective.updated':
        schedulePresenceRotation();
        break;
      case 'communityGoal.updated':
        schedulePresenceRotation();
        break;
      case 'rover.locked':
        schedulePresenceRotation();
        break;
      case 'rover.unlocked':
        schedulePresenceRotation();
        break;
      case 'rovers.allUnlocked':
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
      case 'rover.reboot.userRequested':
        announce({
          channelId: channels.adminAlerts,
          color: 0xf0b651,
          title: 'User Rover Reboot Requested',
          description: `${payload?.by || 'unknown user'} requested reboot for ${payload?.roverName || payload?.roverId || 'unknown rover'}.`,
        });
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
