// Optional detailed command observation, separate from payload-free analytics.
// Subscribers must only enqueue work; recorder failures cannot fail a command.
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const observers = new Set();
const requests = new AsyncLocalStorage();

function subscribeCommandRecording(observer) {
  observers.add(observer);
  return () => observers.delete(observer);
}

function observeCommand(event) {
  if (!observers.size) return;
  const scope = requests.getStore();
  const context = scope?.active ? scope.context : null;
  for (const observer of observers) {
    try {
      // Snapshot before safety code or a caller mutates a nested payload. Each
      // subscriber receives its own copy and cannot change command delivery.
      observer(structuredClone({
        ts: Date.now(),
        monotonicNs: process.hrtime.bigint().toString(),
        source: context ? 'client' : 'server',
        ...context,
        ...event,
      }));
    } catch {
      // Recording is deliberately best-effort at this boundary. The owning
      // recorder reports its storage health independently of driver replies.
    }
  }
}

function recordCommandRequest(socket, request, reply, execute, source = 'client') {
  if (!observers.size) return execute(request, reply);
  const context = { requestId: randomUUID(), socketId: socket.id, userId: socket.data?.userId || null, source };
  const scope = { active: true, context };
  return requests.run(scope, () => {
    try {
      observeCommand({ phase: 'requested', roverId: request?.roverId, command: request });
      return execute(request, (result) => {
        observeCommand({ phase: 'result', roverId: request?.roverId, result });
        if (typeof reply === 'function') reply(result);
      });
    } finally {
      // The command handler is synchronous. A safety timer created inside it
      // inherits async context but its later commands are server actions.
      scope.active = false;
    }
  });
}

module.exports = { subscribeCommandRecording, observeCommand, recordCommandRequest };
