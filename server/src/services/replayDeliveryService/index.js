// Replay Delivery Service
// Purpose: Builds each web-requested replay once and chooses Discord or automatic local hosting.
// Scope: Keeps replay generation functional even when the optional Discord feature is disabled or unhealthy.
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('replayDelivery');
const { subscribe } = require('../eventBus');
const { buildReplayVideo } = require('../replayEngineV2');
const { hostReplay } = require('../replayMediaService');
const {
  createReplayJob,
  createJobStatusEmitter,
  buildAcceptedMessage,
  buildStatusMessage,
  normalizeUserError,
} = require('./workflow');

const jobStatus = createJobStatusEmitter({ io, logger, sanitizeMentions: (value) => String(value || '') });
let preferredDeliveryProvider = null;

function registerPreferredDeliveryProvider(provider) {
  preferredDeliveryProvider = provider && typeof provider.deliver === 'function' ? provider : null;
  return () => {
    if (preferredDeliveryProvider === provider) preferredDeliveryProvider = null;
  };
}

async function deliverReplay(payload = {}) {
  const job = createReplayJob({
    id: payload.jobId,
    requester: payload.requester,
    source: 'web',
    title: payload.title,
    sources: payload.sources,
    includeSidebar: payload.includeSidebar,
    requestedBy: payload.requestedBy,
  });

  jobStatus.emit(job, 'accepted', { message: buildAcceptedMessage(job) });
  let providerContext = null;
  try {
    let providerError = null;
    if (preferredDeliveryProvider?.begin) {
      try {
        providerContext = await preferredDeliveryProvider.begin(job);
      } catch (err) {
        providerError = err;
        logger.warn('Preferred replay delivery could not start; using hosted media', { jobId: job.id, error: err.message });
      }
    }
    jobStatus.emit(job, 'building', { message: buildStatusMessage(job, 'building') });
    if (providerContext?.progressMessage?.edit) {
      await providerContext.progressMessage.edit({ content: buildStatusMessage(job, 'building'), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    }
    const built = await buildReplayVideo({
      sources: job.sources,
      title: job.title,
      requester: job.requester,
      includeSidebar: job.includeSidebar,
    });

    let media = null;
    if (preferredDeliveryProvider && !providerError) {
      try {
        jobStatus.emit(job, 'uploading', { message: buildStatusMessage(job, 'uploading') });
        media = await preferredDeliveryProvider.deliver({ job, context: providerContext, ...built });
      } catch (err) {
        providerError = err;
        if (!providerError.progressMessage && providerContext?.progressMessage) providerError.progressMessage = providerContext.progressMessage;
        logger.warn('Preferred replay delivery failed; using hosted media', { jobId: job.id, error: err.message });
      }
    }

    if (!media) media = await hostReplay({ buffer: built.buffer, job });
    jobStatus.emit(job, 'ready', { message: buildStatusMessage(job, 'ready'), media });
    if (providerError && preferredDeliveryProvider?.completeFallback) {
      await preferredDeliveryProvider.completeFallback({ job, context: providerContext, media }).catch((err) => {
        logger.warn('Unable to announce hosted replay fallback', { jobId: job.id, error: err.message });
      });
    }
    if (providerContext?.stopTyping) providerContext.stopTyping();

    // A Discord progress message may already exist when upload fails. Let the
    // provider attach it to the error so fallback can finish that outward UI
    // instead of leaving a permanent "uploading" message in the channel.
    if (providerError?.progressMessage?.edit) {
      await providerError.progressMessage.edit({ content: buildStatusMessage(job, 'ready'), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    }
    return media;
  } catch (err) {
    if (providerContext?.stopTyping) providerContext.stopTyping();
    const message = normalizeUserError(err);
    jobStatus.emit(job, 'failed', { message });
    if (providerContext?.progressMessage?.edit) {
      await providerContext.progressMessage.edit({ content: message, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    }
    throw err;
  }
}

subscribe('replay.requested', (event) => {
  deliverReplay(event?.payload || {}).catch((err) => {
    logger.warn('Replay delivery failed', { error: err.message });
  });
});

module.exports = {
  deliverReplay,
  registerPreferredDeliveryProvider,
};
