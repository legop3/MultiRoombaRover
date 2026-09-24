// Owns PTZ turns only. Camera IO, permissions and operating-mode entry are supplied
// by the service, so queue transitions cannot create physical rover ownership.
function createParticipation({ io, events, emitChange, getTurnDurationMs, canParticipate, stopMotion, revokeVideo }) {
  const state = { operatorSocketId: null, queue: [], deadline: null, generation: 0 };
  let timer = null;

  function remove(socketId) {
    state.queue = state.queue.filter((id) => id !== socketId);
  }

  function stopOperator(reason) {
    clearTimeout(timer);
    timer = null;
    const previous = state.operatorSocketId;
    state.operatorSocketId = null;
    state.deadline = null;
    state.generation += 1;
    if (!previous) return;
    revokeVideo(previous);
    stopMotion(reason).catch(() => {});
    events.emit('operator', { socketId: previous, action: 'release', reason });
  }

  function scheduleTurn() {
    clearTimeout(timer);
    const duration = getTurnDurationMs();
    state.deadline = Date.now() + duration;
    timer = setTimeout(() => {
      // An expired operator stays when alone, but is not automatically requeued
      // when another participant takes over. Preserve the existing PTZ rule.
      state.queue = state.queue.filter((id) => eligible(id));
      if (state.queue.length) {
        stopOperator('turn-expired');
        advance('turn-expired');
      } else {
        scheduleTurn();
        emitChange('turn-extended-empty-queue');
      }
    }, duration);
  }

  function eligible(socketId) {
    const socket = io.sockets.sockets.get(socketId);
    return socket && !socket.disconnected && canParticipate(socket);
  }

  function advance(reason) {
    while (!state.operatorSocketId && state.queue.length) {
      const next = state.queue.shift();
      if (!eligible(next)) continue;
      state.operatorSocketId = next;
      state.generation += 1;
      scheduleTurn();
      events.emit('operator', { socketId: next, action: 'active' });
    }
    emitChange(reason);
  }

  function claim(socket) {
    if (!eligible(socket.id)) throw new Error('PTZ participation required');
    if (state.operatorSocketId === socket.id || state.queue.includes(socket.id)) return;
    state.queue.push(socket.id);
    advance('queue-join');
  }

  function release(socketId, reason = 'turn-release') {
    remove(socketId);
    if (state.operatorSocketId === socketId) stopOperator(reason);
    advance(reason);
  }

  function reconcile() {
    state.queue = state.queue.filter(eligible);
    if (state.operatorSocketId && !eligible(state.operatorSocketId)) stopOperator('access-change');
    advance('access-change');
  }

  function clear(reason) {
    state.queue = [];
    stopOperator(reason);
  }

  return {
    state, claim, release, reconcile, clear,
    revoke: (reason) => { stopOperator(reason); advance(reason); },
  };
}

module.exports = { createParticipation };
