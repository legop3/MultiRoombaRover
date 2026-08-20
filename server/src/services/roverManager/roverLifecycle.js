// rover Manager lifecycle
// Purpose: Owns rover control membership and switching decisions for sockets.
// Scope: Keeps runtime behavior unchanged by reusing rover-manager state maps and injected policy helpers.
function createRoverLifecycle(deps) {
  const {
    io,
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
    const adminForceControl = force && isAdmin(socket);
    turnService.driverAdded(roverId, socket.id, {
      /*
        `forceTurn` is used by private-rover approval to grant a user the next
        active slot, but it should not freeze the public turn queue. Only an
        explicit admin force-control request is a takeover that pauses rotation.
      */
      force: adminForceControl || forceTurn,
      pauseQueue: adminForceControl,
    });
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

  function removeRoverDrivers(roverId, removedRecord = null) {
    /*
      A rover connection owns the record that contains its driver set, but the
      reverse socket-to-rover index outlives that record. Disconnect cleanup
      must therefore remove both halves before a reconnect creates a fresh
      record with the same id. Otherwise session assignment can name the rover
      while video/control authorization correctly sees no driver membership.

      removedRecord is accepted because rosterLifecycle deliberately deletes
      the public rover record first. Session syncs triggered by the driver
      events below will consequently hide the unavailable rover immediately,
      even before assignmentService finishes normal reassignment.
    */
    const record = removedRecord || rovers.get(roverId);
    if (!record) return [];
    const driverIds = Array.from(record.drivers || []);

    driverIds.forEach((socketId) => {
      const joined = socketToRovers.get(socketId);
      if (joined) {
        joined.delete(roverId);
        if (joined.size === 0) socketToRovers.delete(socketId);
      }

      const socket = io.sockets.sockets.get(socketId);
      socket?.leave(record.room);
      record.drivers.delete(socketId);
      turnService.driverRemoved(roverId, socketId);
      managerEvents.emit('driver', { socketId, roverId, action: 'remove' });
    });

    return driverIds;
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

  function canLeaveCurrentRover(socket, options = {}) {
    const currentId = getPrimaryRoverForSocket(socket.id);
    /*
      Leaving a rover is only risky when this socket is the last person attached
      to an undocked rover. The same rule is used for rover-to-rover switching
      and PTZ camera claiming so there is exactly one definition of "do not
      abandon a rover in the room".
    */
    if (!currentId || currentId === options.targetRoverId) return { ok: true, currentId };
    const currentRecord = rovers.get(currentId);
    if (!currentRecord) return { ok: true, currentId };
    if (hasOtherDrivers(currentRecord, socket.id)) return { ok: true, currentId };
    if (isDockedAndCharging(currentRecord)) return { ok: true, currentId };
    return { ok: false, currentId, message: 'Dock and charge your current rover before switching.' };
  }

  function canSwitchRover(socket, targetRoverId, options = {}) {
    const target = rovers.get(targetRoverId);
    if (!target) return { ok: false, message: 'Unknown rover' };
    const denied = getControlDenialReason(target, socket, {
      allowUser: true,
      allowClosedPrivateGrantInLockdown: Boolean(options.allowClosedPrivateGrantInLockdown),
    });
    if (denied) return { ok: false, message: denied };
    return canLeaveCurrentRover(socket, { targetRoverId });
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
    removeRoverDrivers,
    isDriver,
    canDrive,
    getRoversForSocket,
    getPrimaryRoverForSocket,
    canLeaveCurrentRover,
    canSwitchRover,
    canReplayRoverId,
  };
}

module.exports = {
  createRoverLifecycle,
};
