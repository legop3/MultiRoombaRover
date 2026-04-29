// Chat Broadcast Pipeline
// Purpose: Publishes chat message and typing payloads to event bus while preserving in-memory history.
// Scope: Encapsulates chat fan-out side effects and recent-history accessors.
const { publishEvent } = require('../eventBus');
const { pushHistory, getRecentMessages } = require('./state');

function broadcastMessage(message) {
  pushHistory(message);
  publishEvent({ source: 'chat', type: 'chat:message', payload: message });
}

function broadcastTyping(payload) {
  publishEvent({ source: 'chat', type: 'chat:typing', payload });
}

module.exports = {
  broadcastMessage,
  broadcastTyping,
  getRecentMessages,
};
