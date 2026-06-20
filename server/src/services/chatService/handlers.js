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
const { runChatTextCommand } = require('./textCommands');

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
      const forcedTts = ttsOptions || { speak: true, engine: 'flite' };
      maybeSpeak(socket, message, forcedTts);
      cb({ success: true, privateOnly: true });
      return;
    }

    broadcastMessage(message);
    maybeSendAccessNotice(message, sendSystemMessage);
    maybeSpeak(socket, message, ttsOptions);

    try {
      // Commands sent from site chat should still be visible as normal chat
      // messages. Running the command after broadcast preserves the user-visible
      // transcript while keeping permissions and command execution entirely on
      // the server.
      const ranCommand = await runChatTextCommand({ text: clean, socket, sendSystemMessage });
      cb({ success: true, command: ranCommand });
      return;
    } catch (err) {
      logger.warn('Chat command failed after broadcast', { socket: socket?.id, error: err.message });
      cb({ success: true, command: true, commandError: err.message || 'Command failed' });
      return;
    }

    cb({ success: true });
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
