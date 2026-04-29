// Chat Socket Hooks
// Purpose: Registers chat socket handlers and event-bus fan-out listeners.
// Scope: Bridges socket events to chat handlers and publishes chat updates to connected clients.
const io = require('../../globals/io');
const { subscribe } = require('../eventBus');
const { typingBySocket } = require('./state');
const { buildTypingPayload, resolveRoverId, isPrivateClosedRoverId } = require('./contextBuilders');
const { broadcastTyping } = require('./broadcast');
const { playTypingNote, TYPING_START_NOTE } = require('./notifications');

function registerChatSocketHooks({ history, handleIncoming }) {
  io.on('connection', (socket) => {
    socket.emit('chat:init', history);
    socket.on('chat:send', (payload = {}, cb = () => {}) => handleIncoming(payload, socket, cb));
    socket.on('chat:typing', (payload = {}) => {
      const isTyping = Boolean(payload?.isTyping);
      const wasTyping = typingBySocket.get(socket.id);
      if (isTyping) {
        typingBySocket.set(socket.id, true);
        if (!wasTyping) {
          const roverId = resolveRoverId(socket?.id);
          playTypingNote(roverId, TYPING_START_NOTE, socket?.id);
        }
      } else {
        typingBySocket.delete(socket.id);
      }
      const roverId = resolveRoverId(socket?.id);
      if (isPrivateClosedRoverId(roverId)) return;
      broadcastTyping(buildTypingPayload(socket, { roverId, fromDiscord: false, isTyping }));
    });
    socket.on('disconnect', () => {
      if (!typingBySocket.has(socket.id)) return;
      typingBySocket.delete(socket.id);
      const roverId = resolveRoverId(socket?.id);
      if (isPrivateClosedRoverId(roverId)) return;
      broadcastTyping(buildTypingPayload(socket, { roverId, fromDiscord: false, isTyping: false }));
    });
  });

  subscribe('chat:message', ({ payload }) => {
    if (!payload) return;
    io.emit('chat:message', payload);
  });

  subscribe('chat:typing', ({ payload }) => {
    if (!payload) return;
    io.emit('chat:typing', payload);
  });
}

module.exports = {
  registerChatSocketHooks,
};
