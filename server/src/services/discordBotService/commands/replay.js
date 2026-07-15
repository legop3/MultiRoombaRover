// Discord Replay Command
// Purpose: Handles replay capture requests from Discord through the shared replay job/status workflow.
// Scope: Resolves sources, enforces cooldowns, reports job progress, uploads video, and broadcasts media URLs.
const { AttachmentBuilder } = require('discord.js');
const io = require('../../../globals/io');
const { hostReplay } = require('../../replayMediaService');
const {
  DEFAULT_ALLOWED_MENTIONS,
  buildReplayJobId,
  createReplayJob,
  createJobStatusEmitter,
  createReplaySourceResolver,
  createReplayCaptionBuilder,
  startDiscordTypingLoop,
  sanitizeReplayTitleForFilename,
  firstAttachmentFromMessage,
  buildDiscordReplayMediaPayload,
  buildAcceptedMessage,
  buildStatusMessage,
  normalizeUserError,
} = require('../../replayDeliveryService/workflow');

function createReplayCommand({
  logger,
  getMode,
  MODES,
  tryTriggerReplay,
  getReplaySources,
  getDefaultDiscordSources,
  validateSources,
  buildReplayVideo,
  sanitizeMentions,
  getActiveDrivers,
  getNickname,
  rovers,
  discordConfig,
}) {
  const sourceResolver = createReplaySourceResolver({
    rovers,
    getReplaySources,
    getDefaultDiscordSources,
    validateSources,
  });
  const jobStatus = createJobStatusEmitter({ io, logger, sanitizeMentions });
  const replayCaption = createReplayCaptionBuilder({ io, rovers, getActiveDrivers, getNickname, sanitizeMentions });

  async function replyDenied(message, content) {
    await message.reply({ content: sanitizeMentions(content), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
  }

  return async function handleReplayCommand(message, query) {
    if (getMode() === MODES.LOCKDOWN) {
      await replyDenied(message, 'Replay denied: server is in lockdown.');
      return;
    }

    const resolved = sourceResolver.resolve(query);
    if (resolved?.error) {
      await replyDenied(message, resolved.error);
      return;
    }

    const attempt = tryTriggerReplay({ by: message.author?.id || null, source: 'discord' });
    if (!attempt.ok) {
      await replyDenied(message, `Replay denied: cooldown active. Try again in ${Math.ceil(attempt.remainingMs / 1000)}s.`);
      return;
    }

    const requester = message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
    const job = createReplayJob({
      id: buildReplayJobId('discord'),
      requester,
      source: 'discord',
      sources: resolved.sources || [],
      includeSidebar: true,
    });
    jobStatus.emit(job, 'accepted', { message: buildAcceptedMessage(job) });

    const progressMessage = await message.reply({
      content: sanitizeMentions(buildAcceptedMessage(job)),
      allowedMentions: DEFAULT_ALLOWED_MENTIONS,
    });
    const stopTyping = startDiscordTypingLoop(message.channel, logger, 'discord replay command');

    let builtReplay = null;
    let deliveredMedia = null;
    try {
      jobStatus.emit(job, 'building', { message: buildStatusMessage(job, 'building') });
      if (progressMessage?.edit) {
        await progressMessage.edit({ content: sanitizeMentions(buildStatusMessage(job, 'building')), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
      }

      builtReplay = await buildReplayVideo({
        sources: job.sources,
        title: job.title,
        requester: job.requester,
        includeSidebar: job.includeSidebar,
      });
      const { buffer, usedSources = job.sources, missingSources = [] } = builtReplay;

      jobStatus.emit(job, 'uploading', { message: buildStatusMessage(job, 'uploading') });
      if (progressMessage?.edit) {
        await progressMessage.edit({ content: sanitizeMentions(buildStatusMessage(job, 'uploading')), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
      }

      const attachment = new AttachmentBuilder(buffer, { name: `${sanitizeReplayTitleForFilename(job.title)}.mp4` });
      const body = replayCaption.build({ job, usedSources, missingSources });
      const uploadMessage = await progressMessage.reply({
        content: body,
        files: [attachment],
        allowedMentions: DEFAULT_ALLOWED_MENTIONS,
      });
      if (!uploadMessage) throw new Error('Discord upload did not return a message');

      const uploadedAttachment = firstAttachmentFromMessage(uploadMessage);
      deliveredMedia = buildDiscordReplayMediaPayload({ message: uploadMessage, attachment: uploadedAttachment, job });
      if (!deliveredMedia) throw new Error('Discord upload did not include a replay attachment URL');

      jobStatus.emit(job, 'ready', { message: buildStatusMessage(job, 'ready'), media: deliveredMedia });
      if (progressMessage?.edit) {
        await progressMessage.edit({ content: sanitizeMentions(buildStatusMessage(job, 'ready')), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
      }
    } catch (err) {
      if (deliveredMedia) {
        logger?.warn?.('Replay uploaded but Discord progress message could not be finalized', { jobId: job.id, error: err.message });
        return;
      }
      // A completed video should never be discarded merely because the
      // optional Discord upload failed. Host that exact buffer locally and
      // publish the same ready event consumed by existing clients.
      if (builtReplay?.buffer && !deliveredMedia) {
        try {
          const media = await hostReplay({ buffer: builtReplay.buffer, job });
          jobStatus.emit(job, 'ready', { message: buildStatusMessage(job, 'ready'), media });
          if (progressMessage?.edit) {
            await progressMessage.edit({ content: sanitizeMentions(buildStatusMessage(job, 'ready')), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
          }
          const siteUrl = String(discordConfig?.siteUrl || '').replace(/\/$/, '');
          const publicUrl = siteUrl ? `${siteUrl}${media.url}` : media.url;
          await progressMessage.reply({ content: `Replay hosted by the rover server: ${publicUrl}`, allowedMentions: DEFAULT_ALLOWED_MENTIONS });
          return;
        } catch (fallbackError) {
          logger?.warn?.('Local replay fallback failed', { jobId: job.id, error: fallbackError.message });
        }
      }
      const userMessage = normalizeUserError(err);
      jobStatus.emit(job, 'failed', { message: userMessage });
      if (progressMessage?.edit) {
        await progressMessage.edit({ content: sanitizeMentions(userMessage), allowedMentions: DEFAULT_ALLOWED_MENTIONS });
      } else {
        await replyDenied(message, userMessage);
      }
    } finally {
      stopTyping();
    }
  };
}

module.exports = { createReplayCommand };
