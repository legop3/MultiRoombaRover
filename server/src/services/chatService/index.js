// Chat Service Orchestrator
// Purpose: Composes chat submodules into the public service API and boots socket/event wiring.
// Scope: Keeps external chat contracts stable while delegating logic to focused modules.
const { history } = require('./state');
const { normalizeUserText } = require('./contentFilters');
const { buildMessage, buildTypingPayload } = require('./contextBuilders');
const { broadcastMessage, getRecentMessages } = require('./broadcast');
const { createHandlers } = require('./handlers');
const { registerChatSocketHooks } = require('./socketHooks');

function sendSystemMessage(text) {
  const normalized = normalizeUserText(text);
  const clean = normalized.trim();
  if (!clean) return null;
  const safe = clean.length > 256 ? `${clean.slice(0, 253)}...` : clean;
  const message = buildMessage(null, safe, {
    nickname: 'The Overseer',
    role: 'user',
    fromDiscord: false,
    system: true,
    bot: true,
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
};
