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
    // Uncontested control has no deadline. Starting a new wait gets a full turn,
    // while later queue changes must not reset an already running countdown.
    if (!state.operatorSocketId || !state.queue.length) {
      clearTimeout(timer);
      timer = null;
      state.deadline = null;
      return;
    }
    if (timer) return;
    const duration = getTurnDurationMs();
    state.deadline = Date.now() + duration;
    timer = setTimeout(() => {
      timer = null;
      state.queue = state.queue.filter(eligible);
      if (state.queue.length) {
        // Preserve PTZ's explicit request-to-rejoin rule after a handoff.
        stopOperator('turn-expired');
        advance('turn-expired');
      } else {
        scheduleTurn();
        emitChange('turn-uncontested');
      }
    }, duration);
  }

  function eligible(socketId) {
    const socket = io.sockets.sockets.get(socketId);
    return socket && !socket.disconnected && canParticipate(socket);
  }

  function advance(reason) {
    state.queue = state.queue.filter(eligible);
    while (!state.operatorSocketId && state.queue.length) {
      const next = state.queue.shift();
      if (!eligible(next)) continue;
      state.operatorSocketId = next;
      state.generation += 1;
      events.emit('operator', { socketId: next, action: 'active' });
    }
    scheduleTurn();
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
