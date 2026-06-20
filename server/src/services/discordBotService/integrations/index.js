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
    client.on('typingStart', (typing) => {
      chat.handleDiscordTypingStart(typing).catch((err) => logger.warn('Error handling Discord typing', err.message));
    });

    client.on('messageReactionAdd', (reaction, user) => {
      dm.handleVerificationReaction(reaction, user).catch((err) => logger.warn('Error handling verification reaction', err.message));
      dm.handlePrivateAccessReaction(reaction, user).catch((err) => logger.warn('Error handling private access reaction', err.message));
    });

    subscribe('*', handleBusEvent);
    subscribe('*', userAnnouncements.handleBusEvent);
    subscribe('verification.requested', dm.sendVerificationRequestDms);
    subscribe('privateRoverAccess.requested', dm.sendPrivateRoverAccessRequestDms);
    subscribe('chat:message', chat.handleChatBridgeOutbound);
    subscribe('chat:typing', chat.handleChatTypingOutbound);
    subscribe('discord.bridgeSend', chat.handleBridgeSendRequest);

    return {
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
