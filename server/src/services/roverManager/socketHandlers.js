// rover Manager socket handlers
// Purpose: Encapsulates rover-manager socket event wiring while preserving existing control/lock/spectator behavior.
// Scope: Keeps runtime behavior unchanged by delegating all side effects to injected rover-manager callbacks.
function registerSocketHandlers(deps) {
  const {
    io,
    logger,
    MODES,
    ALERT_COLOR,
    getMode,
    isAdmin,
    isLockdownAdmin,
    sendAlert,
    videoSessions,
    rovers,
    isPrivateRecord,
    isRoverVisibleToSocket,
    tickPrivateAutoClose,
    removeSocket,
    enableSpectator,
    getRosterForSocket,
    canRequestControl,
    canSwitchRover,
    getRoversForSocket,
    requestControl,
    releaseControl,
    managerEvents,
    setPrivateOpen,
    lockRover,
    setPrivateSafety,
  } = deps;

  io.on('connection', (socket) => {
    tickPrivateAutoClose();
    socket.emit('rovers', getRosterForSocket(socket));
    if (socket.data?.role === 'spectator') {
      enableSpectator(socket);
    }

    function handleRequestControl({ roverId, force } = {}, cb = () => {}) {
      try {
        if (socket.data?.role === 'spectator') {
          throw new Error('Spectators cannot drive');
        }
        const mode = getMode();
        if (
          (mode === MODES.ADMIN && !isAdmin(socket)) ||
          (mode === MODES.LOCKDOWN && !isLockdownAdmin(socket))
        ) {
          throw new Error('Admins only');
        }
        const fallbackTargetId = Array.from(rovers.keys()).find(
          (id) => canRequestControl(id, socket, { allowUser: true }).ok,
        );
        const targetId = roverId || fallbackTargetId;
        if (!targetId) {
          throw new Error('No rovers available');
        }
        const previousJoined = getRoversForSocket(socket.id);
        if (!isAdmin(socket)) {
          const { ok, message } = canSwitchRover(socket, targetId);
          if (!ok) {
            throw new Error(message || 'Switch denied');
          }
        }
        const forceAllowed = Boolean(force) && isAdmin(socket);
        logger.info('Request control', socket.id, targetId, { force: forceAllowed });
        requestControl(targetId, socket, { force: forceAllowed, allowUser: true });
        previousJoined.forEach((rid) => {
          if (rid !== targetId) {
            releaseControl(rid, socket);
          }
        });
        videoSessions.revokeWhere(
          (info) =>
            info.socketId === socket.id &&
            info.sourceType === 'rover' &&
            info.sourceId !== targetId &&
            info.sourceId !== `${targetId}-audio`,
        );
        managerEvents.emit('switch', { socketId: socket.id, roverId: targetId });
        socket.emit('controlGranted', { roverId: targetId });
        cb({ success: true, roverId: targetId });
      } catch (err) {
        logger.warn('Request control failed', socket.id, err.message);
        sendAlert({ color: ALERT_COLOR, title: 'Control denied', message: err.message });
        cb({ error: err.message });
      }
    }

    function handleReleaseControl({ roverId } = {}, cb = () => {}) {
      if (!roverId) {
        cb({ error: 'roverId required' });
        return;
      }
      logger.info('Release control', socket.id, roverId);
      releaseControl(roverId, socket);
      cb({ success: true, roverId });
    }

    function handleLockToggle({ roverId, locked } = {}, cb = () => {}) {
      const record = rovers.get(roverId);
      if (!record) {
        cb({ error: 'Unknown rover' });
        return;
      }
      const isPrivate = isPrivateRecord(record);
      if (isPrivate && !isLockdownAdmin(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      if (!isPrivate && !isAdmin(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      try {
        if (isPrivate) {
          const open = !Boolean(locked);
          setPrivateOpen(roverId, open, { reason: 'manual' });
          logger.info('Private state changed', roverId, { open });
        } else {
          lockRover(roverId, locked, { reason: 'manual' });
          logger.info('Lock state changed', roverId, locked);
        }
        cb({ success: true });
      } catch (err) {
        logger.warn('Lock change failed', roverId, err.message);
        sendAlert({ color: ALERT_COLOR, title: 'Lock failed', message: err.message });
        cb({ error: err.message });
      }
    }

    function handlePrivateSafetySet({ roverId, safety } = {}, cb = () => {}) {
      const record = rovers.get(roverId);
      if (!record) {
        cb({ error: 'Unknown rover' });
        return;
      }
      if (!isPrivateRecord(record)) {
        cb({ error: 'Rover is not private' });
        return;
      }
      if (!isLockdownAdmin(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      try {
        const next = setPrivateSafety(roverId, safety || {}, { reason: 'manual' });
        cb({ success: true, safety: next });
      } catch (err) {
        cb({ error: err.message });
      }
    }

    function handleSubscribeAll(_, cb = () => {}) {
      if (socket.data?.role !== 'spectator') {
        cb({ error: 'Spectator role required' });
        return;
      }
      if (getMode() === MODES.LOCKDOWN) {
        cb({ error: 'Spectating disabled in lockdown' });
        return;
      }
      logger.info('Spectator subscribing to all rovers', socket.id);
      for (const record of rovers.values()) {
        if (isRoverVisibleToSocket(record, socket)) {
          socket.join(record.room);
        } else {
          socket.leave(record.room);
        }
      }
      cb({ success: true });
    }

    socket.on('requestControl', handleRequestControl);
    socket.on('session:requestControl', handleRequestControl);
    socket.on('releaseControl', handleReleaseControl);
    socket.on('session:releaseControl', handleReleaseControl);
    socket.on('lockRover', handleLockToggle);
    socket.on('session:lockRover', handleLockToggle);
    socket.on('privateSafety:set', handlePrivateSafetySet);
    socket.on('session:privateSafety:set', handlePrivateSafetySet);
    socket.on('subscribeAll', handleSubscribeAll);
    socket.on('session:subscribeAll', handleSubscribeAll);

    socket.on('disconnecting', () => {
      logger.info('Socket disconnecting', socket.id);
      removeSocket(socket);
      tickPrivateAutoClose();
    });
    socket.on('disconnect', () => {
      logger.info('Socket disconnected', socket.id);
      removeSocket(socket);
      tickPrivateAutoClose();
    });
  });
}

module.exports = {
  registerSocketHandlers,
};
