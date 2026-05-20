// Chat Service Orchestrator
// Purpose: Composes chat submodules into the public service API and boots socket/event wiring.
// Scope: Keeps external chat contracts stable while delegating logic to focused modules.
const { history, clearHistory } = require('./state');
const { normalizeUserText } = require('./contentFilters');
const { buildMessage, buildTypingPayload } = require('./contextBuilders');
const { broadcastMessage, getRecentMessages } = require('./broadcast');
const { createHandlers } = require('./handlers');
const { registerChatSocketHooks } = require('./socketHooks');

function sendSystemMessage(text, options = {}) {
  const normalized = normalizeUserText(text);
  const clean = normalized.trim();
  const hasToolCalls = Array.isArray(options.toolCalls) && options.toolCalls.length > 0;
  if (!clean && !hasToolCalls) return null;
  const safe = clean;
  const message = buildMessage(null, safe, {
    nickname: String(options.nickname || 'The Overseer'),
    role: 'user',
    fromDiscord: false,
    bot: options.bot !== false,
    profileImage: options.profileImage || null,
    toolCalls: hasToolCalls ? options.toolCalls : null,
  });
  broadcastMessage(message);
  return message;
}

const { handleIncoming, sendExternalMessage, sendExternalTyping } = createHandlers({ sendSystemMessage });

registerChatSocketHooks({ history, handleIncoming });

module.exports = {
  handleIncoming,
  sendExternalMessage,
  sendExternalTyping,
  buildTypingPayload,
  sendSystemMessage,
  getRecentMessages,
  clearHistory,
};
