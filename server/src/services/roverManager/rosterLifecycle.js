// rover Manager roster lifecycle
// Purpose: Manages rover record lifecycle, lock/private state transitions, and roster broadcasting.
// Scope: Keeps runtime behavior unchanged while isolating roster mutation and fanout concerns.
function createRosterLifecycle(deps) {
  const {
    io,
    logger,
    sendAlert,
    publishEvent,
    turnService,
    ALERT_COLOR,
    DEFAULT_PRIVATE_SAFETY,
    rovers,
    spectatorSockets,
    managerEvents,
    privateButtonStates,
    privateNoUsersSince,
    privateSafetyTimers,
    privateSafetyStates,
    parsePrivateMeta,
    isPrivateRecord,
    isPrivateOpen,
    getPrivateSafety,
    isRoverVisibleToSocket,
    normalizePrivateSafety,
    stopDockGuard,
  } = deps;

  function ensureRecord(id) {
    if (!rovers.has(id)) {
      rovers.set(id, {
        id,
        meta: null,
        ws: null,
        lastSensor: null,
        lastHostStats: null,
        docked: null,
        lastBumpAt: null,
        drivers: new Set(),
        locked: false,
        lockReason: null,
        batteryState: null,
        nightVisionState: null,
        room: `rover:${id}`,
        lastSeen: Date.now(),
        lastMovementAt: Date.now(),
        private: { enabled: false },
        privateOpen: true,
        privateSafety: { ...DEFAULT_PRIVATE_SAFETY },
      });
    }
    return rovers.get(id);
  }

  function upsertRover(meta, ws) {
    const id = meta.name || meta.id;
    if (!meta.cameraServo) {
      logger.info('Rover hello missing camera servo block', { id, keys: Object.keys(meta || {}) });
    } else {
      logger.info('Rover hello camera servo', { id, servo: meta.cameraServo });
    }
    const isNew = !rovers.has(id);
    const record = ensureRecord(id);
    record.meta = meta;
    record.ws = ws;
    record.lastSeen = Date.now();
    const privateMeta = parsePrivateMeta(meta);
    const wasPrivate = isPrivateRecord(record);
    record.private = privateMeta;
    record.privateSafety = normalizePrivateSafety(privateMeta.safety);
    if (privateMeta.enabled) {
      if (isNew || !wasPrivate) record.privateOpen = false;
    } else {
      record.privateOpen = true;
    }
    if (record.nightVisionState == null && meta?.nightVision?.enabled) {
      const ledOn = Boolean(meta.nightVision.initialOn);
      record.nightVisionState = {
        nightVisionOn: !ledOn,
        updatedAt: Date.now(),
      };
    }
    rovers.set(id, record);
    spectatorSockets.forEach((socketId) => {
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) return;
      if (isRoverVisibleToSocket(record, sock)) sock.join(record.room);
      else sock.leave(record.room);
    });
    managerEvents.emit('rover', { roverId: id, action: 'upsert', record });
    if (isNew) publishEvent({ source: 'roverManager', type: 'rover.online', payload: { roverId: id } });
    broadcastRoster();
    return record;
  }

  function removeRover(id) {
    const record = rovers.get(id);
    if (!record) return;
    rovers.delete(id);
    stopDockGuard(id);
    privateButtonStates.delete(id);
    privateNoUsersSince.delete(id);
    privateSafetyStates.delete(id);
    clearTimeout(privateSafetyTimers.get(id));
    privateSafetyTimers.delete(id);
    turnService.cleanupRover(id);
    spectatorSockets.forEach((socketId) => {
      const sock = io.sockets.sockets.get(socketId);
      sock?.leave(record.room);
    });
    broadcastRoster();
    managerEvents.emit('rover', { roverId: id, action: 'removed' });
    publishEvent({ source: 'roverManager', type: 'rover.offline', payload: { roverId: id } });
  }

  function sendPrivateToggleTTS(roverId, open, reason) {
    const { issueCommand } = require('../commandService');
    let text = open ? 'Private rover is now open.' : 'Private rover is now closed.';
    if (!open && reason === 'auto_idle') text = 'Private rover closed due to inactivity.';
    else if (reason === 'button_hold') text = open ? 'Private rover opened locally.' : 'Private rover closed locally.';
    try {
      issueCommand(roverId, { type: 'tts', tts: { text, speak: true } });
    } catch (err) {
      logger.warn('Private toggle TTS failed', { roverId, reason, error: err.message });
    }
  }

  function lockRover(id, locked, options = {}) {
    const record = rovers.get(id);
    if (!record) throw new Error('Unknown rover');
    const wasAllUnlocked = Array.from(rovers.values()).every((entry) => !entry.locked);
    const reason = locked ? options.reason || 'manual' : null;
    const silent = Boolean(options.silent);
    if (locked) {
      record.locked = true;
      record.lockReason = reason;
      if (!silent) {
        sendAlert({
          color: ALERT_COLOR,
          title: 'Rover Locked',
          message: `${id} locked${record.lockReason ? ` (${record.lockReason})` : ''}.`,
        });
      }
      publishEvent({ source: 'roverManager', type: 'rover.locked', payload: { roverId: id, reason: record.lockReason } });
    } else {
      record.locked = false;
      record.lockReason = null;
      if (!silent) sendAlert({ color: ALERT_COLOR, title: 'Rover Unlocked', message: `${id} unlocked.` });
      publishEvent({ source: 'roverManager', type: 'rover.unlocked', payload: { roverId: id } });
      const isAllUnlocked = Array.from(rovers.values()).every((entry) => !entry.locked);
      if (!wasAllUnlocked && isAllUnlocked) {
        publishEvent({ source: 'roverManager', type: 'rovers.allUnlocked', payload: { roverId: id } });
      }
    }
    broadcastRoster();
    managerEvents.emit('lock', { roverId: id, locked: record.locked, reason: record.lockReason });
    return record.locked;
  }

  function setPrivateOpen(id, open, options = {}) {
    const record = rovers.get(id);
    if (!record) throw new Error('Unknown rover');
    if (!isPrivateRecord(record)) throw new Error('Rover is not private');
    const nextOpen = Boolean(open);
    if (record.privateOpen === nextOpen) return nextOpen;
    record.privateOpen = nextOpen;
    const reason = options.reason || 'manual';
    const silent = Boolean(options.silent);
    if (!nextOpen) {
      privateNoUsersSince.delete(id);
      privateSafetyStates.delete(id);
      clearTimeout(privateSafetyTimers.get(id));
      privateSafetyTimers.delete(id);
    }
    if (!silent) {
      sendAlert({
        color: ALERT_COLOR,
        title: nextOpen ? 'Private Rover Opened' : 'Private Rover Closed',
        message: nextOpen ? `${id} opened (${reason}).` : `${id} closed (${reason}).`,
      });
    }
    if (options.tts !== false) sendPrivateToggleTTS(id, nextOpen, reason);
    publishEvent({
      source: 'roverManager',
      type: nextOpen ? 'rover.privateOpened' : 'rover.privateClosed',
      payload: { roverId: id, reason },
    });
    managerEvents.emit('private', { roverId: id, open: nextOpen, reason });
    broadcastRoster();
    return nextOpen;
  }

  function setPrivateSafety(id, patch = {}, options = {}) {
    const record = rovers.get(id);
    if (!record) throw new Error('Unknown rover');
    if (!isPrivateRecord(record)) throw new Error('Rover is not private');
    const current = getPrivateSafety(record);
    const next = normalizePrivateSafety({ ...current, ...(patch || {}) });
    record.privateSafety = next;
    const reason = options.reason || 'manual';
    publishEvent({
      source: 'roverManager',
      type: 'rover.privateSafetyUpdated',
      payload: { roverId: id, reason, safety: next },
    });
    managerEvents.emit('privateSafety', { roverId: id, reason, safety: next });
    broadcastRoster();
    return next;
  }

  function getRoster() {
    return Array.from(rovers.values()).map((record) => ({
      id: record.id,
      name: record.meta?.name || record.id,
      description: record.meta?.description,
      color: record.meta?.color || null,
      battery: record.meta?.battery,
      batteryState: record.batteryState,
      maxWheelSpeed: record.meta?.maxWheelSpeed,
      media: record.meta?.media,
      cameraServo: record.meta?.cameraServo,
      audio: record.meta?.audio,
      horn: record.meta?.horn,
      nightVision: record.meta?.nightVision
        ? { ...record.meta.nightVision, state: record.nightVisionState }
        : record.meta?.nightVision,
      locked: record.locked || (isPrivateRecord(record) && !isPrivateOpen(record)),
      lockReason: record.lockReason || (isPrivateRecord(record) && !isPrivateOpen(record) ? 'private' : null),
      lastSeen: record.lastSeen,
      private: isPrivateRecord(record)
        ? { enabled: true, open: isPrivateOpen(record), safety: getPrivateSafety(record) }
        : { enabled: false, open: true, safety: getPrivateSafety(record) },
    }));
  }

  function getRosterForSocket(socket) {
    return getRoster().filter((entry) => {
      const record = rovers.get(String(entry.id));
      return isRoverVisibleToSocket(record, socket);
    });
  }

  function syncSpectatorRooms() {
    spectatorSockets.forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return;
      for (const record of rovers.values()) {
        if (isRoverVisibleToSocket(record, socket)) socket.join(record.room);
        else socket.leave(record.room);
      }
    });
  }

  function broadcastRoster() {
    syncSpectatorRooms();
    io.sockets.sockets.forEach((socket) => {
      socket.emit('rovers', getRosterForSocket(socket));
    });
  }

  function setNightVisionState(roverId, nightVisionOn) {
    const record = rovers.get(roverId);
    if (!record) return;
    if (typeof nightVisionOn !== 'boolean') return;
    record.nightVisionState = {
      nightVisionOn,
      updatedAt: Date.now(),
    };
    broadcastRoster();
    managerEvents.emit('rover', { roverId, action: 'nightVision', record });
  }

  function handleHostStats(roverId, msg = {}) {
    const record = rovers.get(roverId);
    if (!record) return;
    const stats = msg && typeof msg.stats === 'object' && msg.stats ? msg.stats : {};
    const receivedAt = Date.now();

    // Host stats describe the Pi/Linux side of a rover, so they are stored
    // separately from lastSensor and emitted on their own browser event. That
    // keeps raw Roomba sensor frames from becoming a mixed metadata channel.
    record.lastHostStats = {
      raw: msg,
      stats,
      receivedAt,
    };
    record.lastSeen = receivedAt;

    io.to(record.room).volatile.emit('roverHostStats', {
      roverId,
      stats,
      receivedAt,
    });
    managerEvents.emit('hostStats', { roverId, stats, receivedAt });
  }

  function canSeeRover(roverId, socket) {
    const record = rovers.get(String(roverId));
    return isRoverVisibleToSocket(record, socket);
  }

  function canRequestControl(roverId, socket, options = {}) {
    const record = rovers.get(String(roverId));
    const denied = deps.getControlDenialReason(record, socket, options);
    return { ok: !denied, reason: denied || null };
  }

  return {
    ensureRecord,
    upsertRover,
    removeRover,
    lockRover,
    setPrivateOpen,
    setPrivateSafety,
    getRoster,
    getRosterForSocket,
    syncSpectatorRooms,
    broadcastRoster,
    setNightVisionState,
    handleHostStats,
    canSeeRover,
    canRequestControl,
  };
}

module.exports = {
  createRosterLifecycle,
};
