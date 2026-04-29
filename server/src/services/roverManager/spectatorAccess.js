// rover Manager spectator access
// Purpose: Manages spectator room joins and private auto-close behavior.
// Scope: Keeps runtime behavior unchanged while isolating spectator-specific orchestration.
function createSpectatorAccess(deps) {
  const {
    io,
    logger,
    rovers,
    spectatorSockets,
    privateNoUsersSince,
    PRIVATE_AUTO_CLOSE_IDLE_MS,
    isPrivateRecord,
    isPrivateOpen,
    isRoverVisibleToSocket,
    setPrivateOpen,
  } = deps;

  function enableSpectator(socket) {
    if (!socket?.id || spectatorSockets.has(socket.id)) return;
    spectatorSockets.add(socket.id);
    for (const record of rovers.values()) {
      if (isRoverVisibleToSocket(record, socket)) {
        socket.join(record.room);
      } else {
        socket.leave(record.room);
      }
    }
  }

  function disableSpectator(socket) {
    if (!socket?.id || !spectatorSockets.has(socket.id)) return;
    spectatorSockets.delete(socket.id);
    for (const record of rovers.values()) {
      socket.leave(record.room);
    }
  }

  function tickPrivateAutoClose() {
    const now = Date.now();
    const onlineCount = io.sockets.sockets.size;
    for (const record of rovers.values()) {
      if (!isPrivateRecord(record) || !isPrivateOpen(record)) {
        privateNoUsersSince.delete(record.id);
        continue;
      }
      if (record.drivers && record.drivers.size > 0) {
        privateNoUsersSince.delete(record.id);
        continue;
      }
      if (onlineCount > 0) {
        privateNoUsersSince.delete(record.id);
        continue;
      }
      const since = privateNoUsersSince.get(record.id) || now;
      if (!privateNoUsersSince.has(record.id)) {
        privateNoUsersSince.set(record.id, since);
        continue;
      }
      if (now - since >= PRIVATE_AUTO_CLOSE_IDLE_MS) {
        try {
          setPrivateOpen(record.id, false, { reason: 'auto_idle', tts: true });
        } catch (err) {
          logger.warn('Private auto-close failed', { roverId: record.id, error: err.message });
        }
        privateNoUsersSince.delete(record.id);
      }
    }
  }

  return {
    enableSpectator,
    disableSpectator,
    tickPrivateAutoClose,
  };
}

module.exports = {
  createSpectatorAccess,
};
