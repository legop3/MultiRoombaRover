// rover Manager lifecycle
// Purpose: Owns rover control membership and switching decisions for sockets.
// Scope: Keeps runtime behavior unchanged by reusing rover-manager state maps and injected policy helpers.
function createRoverLifecycle(deps) {
  const {
    rovers,
    socketToRovers,
    managerEvents,
    turnService,
    isAdmin,
    sendAlert,
    ALERT_COLOR,
    getMode,
    getControlDenialReason,
  } = deps;

  function removeSocket(socket, disableSpectator) {
    const joined = socketToRovers.get(socket.id);
    if (!joined) {
      disableSpectator(socket);
      return;
    }
    for (const roverId of joined) {
      const record = rovers.get(roverId);
      if (record) {
        record.drivers.delete(socket.id);
      }
      turnService.driverRemoved(roverId, socket.id);
      managerEvents.emit('driver', { socketId: socket.id, roverId, action: 'remove' });
    }
    socketToRovers.delete(socket.id);
    disableSpectator(socket);
  }

  function requestControl(roverId, socket, options = {}) {
    const {
      force = false,
      allowUser = false,
      forceTurn = false,
      allowClosedPrivateGrantInLockdown = false,
    } = options;
    const record = rovers.get(roverId);
    const denied = getControlDenialReason(record, socket, {
      allowUser,
      allowClosedPrivateGrantInLockdown,
    });
    if (denied) throw new Error(denied);
    record.drivers.add(socket.id);
    if (!socketToRovers.has(socket.id)) {
      socketToRovers.set(socket.id, new Set());
    }
    socketToRovers.get(socket.id).add(roverId);
    socket.join(record.room);
    turnService.driverAdded(roverId, socket.id, (force && isAdmin(socket)) || forceTurn);
    socket.emit('controlGranted', { roverId });
    managerEvents.emit('driver', { socketId: socket.id, roverId, action: 'add' });
    sendAlert({
      color: ALERT_COLOR,
      title: 'Control Granted',
      message: `${socket.id} now driving ${roverId}`,
    });
    return { roverId, room: record.room };
  }

  function releaseControl(roverId, socket) {
    const record = rovers.get(roverId);
    if (!record) return;
    record.drivers.delete(socket.id);
    const joined = socketToRovers.get(socket.id);
    if (joined) {
      joined.delete(roverId);
      if (joined.size === 0) socketToRovers.delete(socket.id);
    }
    socket.leave(record.room);
    turnService.driverRemoved(roverId, socket.id);
    managerEvents.emit('driver', { socketId: socket.id, roverId, action: 'remove' });
  }

  function isDriver(roverId, socket) {
    const record = rovers.get(roverId);
    if (!record) return false;
    return record.drivers.has(socket.id);
  }

  function canDrive(roverId, socket) {
    const record = rovers.get(roverId);
    if (!record) return false;
    if (isAdmin(socket)) return true;
    if (!socket || !isDriver(roverId, socket)) return false;
    const denied = getControlDenialReason(record, socket, {
      allowUser: true,
      allowClosedPrivateGrantInLockdown: true,
      allowClosedPrivateCurrentDriver: true,
    });
    if (denied) return false;
    const _mode = getMode();
    return turnService.canDrive(roverId, socket);
  }

  function getRoversForSocket(socketId) {
    const joined = socketToRovers.get(socketId);
    if (!joined || joined.size === 0) return [];
    return Array.from(joined);
  }

  function getPrimaryRoverForSocket(socketId) {
    const joined = socketToRovers.get(socketId);
    if (!joined || joined.size === 0) return null;
    const iterator = joined.values();
    const first = iterator.next();
    return first.done ? null : first.value;
  }

  function isDockedAndCharging(record) {
    const sensors = record?.lastSensor?.decoded || record?.lastSensor?.sensors || null;
    if (!sensors) return false;
    const docked = Boolean(sensors.chargingSources?.homeBase);
    const code = sensors.chargingState?.code;
    const charging = code === 2 || code === 3 || code === 4;
    return docked && charging;
  }

  function hasOtherDrivers(record, socketId) {
    if (!record) return false;
    for (const driver of record.drivers) {
      if (driver !== socketId) return true;
    }
    return false;
  }

  function canSwitchRover(socket, targetRoverId, options = {}) {
    const target = rovers.get(targetRoverId);
    if (!target) return { ok: false, message: 'Unknown rover' };
    const denied = getControlDenialReason(target, socket, {
      allowUser: true,
      allowClosedPrivateGrantInLockdown: Boolean(options.allowClosedPrivateGrantInLockdown),
    });
    if (denied) return { ok: false, message: denied };
    const currentId = getPrimaryRoverForSocket(socket.id);
    if (!currentId || currentId === targetRoverId) return { ok: true, currentId };
    const currentRecord = rovers.get(currentId);
    if (!currentRecord) return { ok: true, currentId };
    if (hasOtherDrivers(currentRecord, socket.id)) return { ok: true, currentId };
    if (isDockedAndCharging(currentRecord)) return { ok: true, currentId };
    return { ok: false, currentId, message: 'Dock and charge your current rover before switching.' };
  }

  function canReplayRoverId(roverId, isPrivateRecord, isPrivateOpen) {
    const record = rovers.get(String(roverId));
    if (!record) return false;
    if (!isPrivateRecord(record)) return true;
    return isPrivateOpen(record);
  }

  return {
    removeSocket,
    requestControl,
    releaseControl,
    isDriver,
    canDrive,
    getRoversForSocket,
    getPrimaryRoverForSocket,
    canSwitchRover,
    canReplayRoverId,
  };
}

module.exports = {
  createRoverLifecycle,
};
