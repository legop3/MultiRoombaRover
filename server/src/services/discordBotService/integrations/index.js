// Discord Integrations Coordinator
// Purpose: Composes split integration handlers and registers Discord/event-bus subscriptions.
// Scope: Wires message/typing/reaction handlers and exposes bridge inbound handler.
const { createDmModerationHandlers } = require('./dmModeration');
const { createChatBridgeHandlers } = require('./chatBridge');
const { createBusEventHandler } = require('./busEvents');
const { createUserAnnouncements } = require('../userAnnouncements');
const { sanitizeMentions, formatDuration, formatWebhookUsername, getTypingId } = require('./helpers');

function createIntegrations(deps) {
  const {
    logger,
    client,
    subscribe,
    sendToChannel,
    clearTypingMessage,
    sendTypingMessage,
    schedulePresenceRotation,
  } = deps;

  const dm = createDmModerationHandlers({ ...deps, sanitizeMentions });
  const chat = createChatBridgeHandlers({ ...deps, clearTypingMessage, sendTypingMessage, formatWebhookUsername, getTypingId });
  const { handleBusEvent } = createBusEventHandler({ ...deps, sendToChannel, schedulePresenceRotation, formatDuration });
  const userAnnouncements = createUserAnnouncements({ ...deps, sendToChannel, schedulePresenceRotation });

  function register() {
    let stopped = false;
    client.on('typingStart', (typing) => {
      chat.handleDiscordTypingStart(typing).catch((err) => logger.warn('Error handling Discord typing', err.message));
    });

    client.on('messageReactionAdd', (reaction, user) => {
      dm.handleVerificationReaction(reaction, user).catch((err) => logger.warn('Error handling verification reaction', err.message));
      dm.handlePrivateAccessReaction(reaction, user).catch((err) => logger.warn('Error handling private access reaction', err.message));
    });

    // Only the active, ready connection consumes server events. Retain each
    // unsubscribe function so replacement clients never duplicate deliveries.
    const unsubscribe = [];
    function subscribeWhileReady(type, handler) {
      unsubscribe.push(subscribe(type, (event) => {
        Promise.resolve().then(() => {
          if (!stopped && client.isReady()) return handler(event);
        }).catch((err) => {
          logger.warn('Error handling Discord integration event', { type, error: err.message });
        });
      }));
    }

    subscribeWhileReady('*', handleBusEvent);
    subscribeWhileReady('*', userAnnouncements.handleBusEvent);
    subscribeWhileReady('verification.requested', dm.sendVerificationRequestDms);
    subscribeWhileReady('privateRoverAccess.requested', dm.sendPrivateRoverAccessRequestDms);
    subscribeWhileReady('chat:message', chat.handleChatBridgeOutbound);
    subscribeWhileReady('chat:typing', chat.handleChatTypingOutbound);

    return {
      stop() {
        stopped = true;
        unsubscribe.forEach((remove) => remove());
      },
      handleBridgeInbound: chat.handleBridgeInbound,
      handleBusEvent,
    };
  }

  return {
    register,
  };
}

module.exports = {
  createIntegrations,
};
