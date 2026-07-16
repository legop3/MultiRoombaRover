// Chat Message Handlers
// Purpose: Handles inbound socket/external chat payloads and applies moderation, routing, and side effects.
// Scope: Owns message validation pipeline and typed outbound message construction.
const logger = require('../../globals/logger').child('chatService');
const { getRole } = require('../roleService');
const { withinRateLimit } = require('./state');
const { hasProfanity, isKeymash, normalizeUserText } = require('./contentFilters');
const { buildMessage, buildTypingPayload, resolveRoverId, isPrivateClosedRoverId, buildRoverCtxSnapshot } = require('./contextBuilders');
const { broadcastMessage, broadcastTyping } = require('./broadcast');
const { playTypingNote, normalizeTtsOptions, maybeSendAccessNotice, maybeSpeak, TYPING_SEND_NOTE } = require('./notifications');
const { isTextCommand, runChatTextCommand } = require('./textCommands');

function createHandlers({ sendSystemMessage }) {
  async function handleIncoming({ text, tts, bot = false, profileImage = null } = {}, socket, cb = () => {}) {
    const role = getRole(socket);
    void role;
    const normalized = normalizeUserText(text);
    const clean = normalized.trim();
    if (!clean) return cb({ error: 'Message required' });
    if (!withinRateLimit(socket.id)) return cb({ error: 'Slow down' });
    // This service no longer enforces a character-count ceiling for chat text.
    // The chat layer only rejects empty, rate-limited, or moderated content so
    // users can send long messages without hitting an arbitrary local cap.
    // Transport-specific integrations may still constrain their own payloads
    // where an external API or rover-side feature has a real hard limit.
    if (hasProfanity(clean)) return cb({ error: 'Message blocked' });

    const roverId = resolveRoverId(socket?.id);
    const ttsOptions = normalizeTtsOptions(tts);
    const message = buildMessage(socket, clean, {
      fromDiscord: false,
      roverId,
      roverCtx: buildRoverCtxSnapshot(roverId),
      tts: ttsOptions,
      bot,
      profileImage,
    });

    logger.info('Chat message', { socket: socket.id, roverId: message.roverId });
    playTypingNote(roverId, TYPING_SEND_NOTE, socket?.id);

    if (isPrivateClosedRoverId(message.roverId)) {
      // Private-closed chat does not broadcast the text, so TTS is the only
      // delivery path. Use the same Google speech default as normal chat when
      // the sender did not provide explicit TTS settings.
      const forcedTts = ttsOptions || { speak: true, engine: 'chromegtts' };
      maybeSpeak(socket, message, forcedTts);
      cb({ success: true, privateOnly: true });
      return;
    }

    broadcastMessage(message);
    maybeSendAccessNotice(message, sendSystemMessage);
    maybeSpeak(socket, message, ttsOptions);

    const command = isTextCommand(clean);
    // Chat delivery is complete once validation, broadcast, and local side
    // effects above have succeeded. A command may wait on Home Assistant,
    // hardware, replay preparation, or an external transport, so tying the
    // socket acknowledgement to command completion leaves the browser's send
    // promise pending and makes its input state appear stuck. Acknowledge now;
    // command replies continue through the normal Rover bot message stream.
    cb({ success: true, command });

    if (command) {
      // Deliberately do not await this promise. runChatTextCommand already turns
      // ordinary command failures into visible bot messages; this final catch
      // protects the service from an unexpected setup/programming failure and
      // cannot attempt a second acknowledgement after the UI has moved on.
      void runChatTextCommand({ text: clean, socket, sendSystemMessage }).catch((err) => {
        logger.warn('Chat command failed after acknowledgement', { socket: socket?.id, error: err.message });
        sendSystemMessage(`Command failed: ${err.message || 'unknown error'}`, { nickname: 'Rover bot', bot: true });
      });
    }
    return;
  }

  function sendExternalMessage({ text, nickname = 'Discord', role = 'admin', roverId = null, discordGuildId = null, discordGuildName = null, discordGuildIconUrl = null, discordChannelId = null, discordUserId = null, discordUserName = null, discordUserAvatarUrl = null, bot = false, profileImage = null }) {
    const normalized = normalizeUserText(text);
    const clean = normalized.trim();
    // Direct socket chat and bridged external chat intentionally share the
    // same validation posture: an empty message is invalid, but message length
    // is not capped here. Keeping the character limit out of this service lets
    // chat accept long user messages while the downstream integrations that
    // have hard platform limits, such as Discord replies or rover TTS, continue
    // to enforce their own transport-specific safeguards.
    if (!clean) throw new Error('Message invalid');
    if (hasProfanity(clean)) throw new Error('Message blocked');
    if (isKeymash(clean)) throw new Error('Message looks like spam');
    if (isPrivateClosedRoverId(roverId)) throw new Error('Private rover chat is closed');

    const message = buildMessage(null, clean, {
      nickname,
      role,
      roverId,
      roverCtx: buildRoverCtxSnapshot(roverId),
      fromDiscord: true,
      discordGuildId,
      discordGuildName,
      discordGuildIconUrl,
      discordChannelId,
      discordUserId,
      discordUserName,
      discordUserAvatarUrl,
      bot,
      profileImage,
    });

    logger.info('External chat message', { roverId, nickname });
    broadcastMessage(message);
    maybeSendAccessNotice(message, sendSystemMessage);
    return message;
  }

  function sendExternalTyping({ nickname = 'Discord', role = 'user', roverId = null, discordGuildId = null, discordGuildName = null, discordGuildIconUrl = null, discordChannelId = null, discordUserId = null, discordUserName = null, discordUserAvatarUrl = null, isTyping = true }) {
    if (isPrivateClosedRoverId(roverId)) return null;
    const payload = buildTypingPayload(null, { nickname, role, roverId, fromDiscord: true, discordGuildId, discordGuildName, discordGuildIconUrl, discordChannelId, discordUserId, discordUserName, discordUserAvatarUrl, isTyping });
    broadcastTyping(payload);
    return payload;
  }

  return {
    handleIncoming,
    sendExternalMessage,
    sendExternalTyping,
  };
}

module.exports = {
  createHandlers,
};
