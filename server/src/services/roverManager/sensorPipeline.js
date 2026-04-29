// rover Manager sensor pipeline
// Purpose: Handles sensor-frame processing, private safety triggers, and dock-guard responses.
// Scope: Keeps runtime behavior unchanged while isolating stateful sensor/dock logic from service orchestration.
function createSensorPipeline(deps) {
  const {
    io,
    logger,
    rovers,
    managerEvents,
    dockGuardStates,
    backoffTimers,
    privateButtonStates,
    privateSafetyTimers,
    privateSafetyStates,
    parseSensorFrame,
    computeBatteryState,
    clampInt,
    DEFAULT_PRIVATE_SAFETY,
    SAFETY_BACKOFF_MIN,
    SAFETY_BACKOFF_MAX,
    PRIVATE_BUTTON_HOLD_MS,
    IDLE_UNDOCKED_MS,
    PASSIVE_UNDOCKED_MS,
    DOCK_GUARD_RETRY_MS,
    DOCK_GUARD_WINDOW_MS,
    DOCK_COMMAND_BASE64,
    BACKOFF_MS,
    BACKOFF_SPEED,
    ALERT_COLOR,
    sendAlert,
    publishEvent,
    isPrivateRecord,
    isPrivateOpen,
    getPrivateSafety,
    setPrivateOpen,
    shouldApplyPrivateSafety,
    shouldApplyPrivateSensorSafety,
  } = deps;

  function getPrivateSafetyState(roverId) {
    if (!privateSafetyStates.has(roverId)) {
      privateSafetyStates.set(roverId, {
        blockedUntil: 0,
        lastOvercurrent: false,
        lastBump: false,
        lastCliff: false,
      });
    }
    return privateSafetyStates.get(roverId);
  }

  function stopSafetyBackoffTimer(roverId) {
    clearTimeout(privateSafetyTimers.get(roverId));
    privateSafetyTimers.delete(roverId);
  }

  function triggerSafetyAction(record, mode, options = {}) {
    if (!record) return;
    const roverId = record.id;
    const { issueCommand, setDriveCooldown } = require('../commandService');
    const now = Date.now();
    const cooldownMs = clampInt(options.cooldownMs, 100, 10000, DEFAULT_PRIVATE_SAFETY.triggerCooldownMs);
    const backoffMs = clampInt(options.backoffMs, 50, 5000, 0);
    const backoffSpeed = clampInt(options.backoffSpeed, 0, 500, 0);
    try {
      issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
      issueCommand(roverId, { type: 'motors', motorPwm: { main: 0, side: 0, vacuum: 0 } });
    } catch (err) {
      logger.warn('Private safety stop failed', { roverId, mode, error: err.message });
    }
    stopSafetyBackoffTimer(roverId);
    if (backoffMs > 0 && backoffSpeed > 0) {
      const speed = Math.max(SAFETY_BACKOFF_MIN, Math.min(SAFETY_BACKOFF_MAX, -Math.abs(backoffSpeed)));
      try {
        issueCommand(roverId, { type: 'drive', driveDirect: { left: speed, right: speed } });
      } catch (err) {
        logger.warn('Private safety backoff failed', { roverId, mode, error: err.message });
      }
      privateSafetyTimers.set(
        roverId,
        setTimeout(() => {
          try {
            issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
          } catch (err) {
            logger.warn('Private safety backoff stop failed', { roverId, mode, error: err.message });
          }
          privateSafetyTimers.delete(roverId);
        }, backoffMs),
      );
    }
    setDriveCooldown(roverId, Math.max(cooldownMs, backoffMs));
    const state = getPrivateSafetyState(roverId);
    state.blockedUntil = now + Math.max(cooldownMs, backoffMs);
    sendAlert({
      color: ALERT_COLOR,
      title: 'Private Safety',
      message: `${roverId} ${mode} safety triggered.`,
    });
    publishEvent({
      source: 'roverManager',
      type: 'rover.privateSafetyTriggered',
      payload: { roverId, mode, cooldownMs, backoffMs, backoffSpeed },
    });
  }

  function evaluatePrivateSafety(record, sensors) {
    if (!record || !sensors) return;
    const roverId = record.id;
    const state = getPrivateSafetyState(roverId);
    const overcurrent = Boolean(
      sensors?.wheelOvercurrents?.leftWheel ||
        sensors?.wheelOvercurrents?.rightWheel ||
        sensors?.wheelOvercurrents?.mainBrush ||
        sensors?.wheelOvercurrents?.sideBrush,
    );
    const bump = Boolean(sensors?.bumpsAndWheelDrops?.bumpLeft || sensors?.bumpsAndWheelDrops?.bumpRight);
    const cliff = Boolean(
      sensors?.cliffLeft || sensors?.cliffFrontLeft || sensors?.cliffFrontRight || sensors?.cliffRight,
    );
    const currentOver = overcurrent;
    const currentBump = bump;
    const currentCliff = cliff;
    if (!shouldApplyPrivateSensorSafety(record)) {
      state.blockedUntil = 0;
      state.lastOvercurrent = currentOver;
      state.lastBump = currentBump;
      state.lastCliff = currentCliff;
      return;
    }
    const safety = getPrivateSafety(record);
    const now = Date.now();
    if (now < Number(state.blockedUntil || 0)) {
      state.lastOvercurrent = currentOver;
      state.lastBump = currentBump;
      state.lastCliff = currentCliff;
      return;
    }
    let triggered = false;
    if (safety.hardOvercurrentEnabled && currentOver && !state.lastOvercurrent) {
      triggerSafetyAction(record, 'overcurrent', {
        cooldownMs: safety.triggerCooldownMs,
        backoffMs: safety.overcurrentStopMs,
        backoffSpeed: 0,
      });
      triggered = true;
    } else if (safety.hardBumpEnabled && currentBump && !state.lastBump) {
      triggerSafetyAction(record, 'bump', {
        cooldownMs: safety.triggerCooldownMs,
        backoffMs: safety.bumpBackoffMs,
        backoffSpeed: safety.bumpBackoffSpeed,
      });
      triggered = true;
    } else if (safety.cliffEnabled && currentCliff && !state.lastCliff) {
      triggerSafetyAction(record, 'cliff', {
        cooldownMs: safety.triggerCooldownMs,
        backoffMs: safety.cliffBackoffMs,
        backoffSpeed: safety.cliffBackoffSpeed,
      });
      triggered = true;
    }
    if (!triggered) state.blockedUntil = 0;
    state.lastOvercurrent = currentOver;
    state.lastBump = currentBump;
    state.lastCliff = currentCliff;
  }

  function applyPrivateDriveSafety(roverId, socket, driveDirect = null) {
    const record = rovers.get(String(roverId));
    if (!record || !driveDirect || typeof driveDirect !== 'object') return driveDirect;
    if (!shouldApplyPrivateSafety(record, socket)) return driveDirect;
    const safety = getPrivateSafety(record);
    if (!safety.speedLimitEnabled) return driveDirect;
    const limit = clampInt(safety.speedLimitMaxWheelSpeed, 1, 500, DEFAULT_PRIVATE_SAFETY.speedLimitMaxWheelSpeed);
    const left = clampInt(driveDirect.left, -500, 500, 0);
    const right = clampInt(driveDirect.right, -500, 500, 0);
    return { ...driveDirect, left: Math.max(-limit, Math.min(limit, left)), right: Math.max(-limit, Math.min(limit, right)) };
  }

  function handlePrivateButtonHold(record, sensors) {
    if (!record || !isPrivateRecord(record)) return;
    const buttons = sensors?.buttons || null;
    const pressed = Boolean(buttons?.spot && buttons?.clean && buttons?.dock);
    const roverId = record.id;
    const now = Date.now();
    const state = privateButtonStates.get(roverId) || { pressedSince: null, latched: false };
    if (!pressed) {
      if (state.pressedSince != null || state.latched) {
        privateButtonStates.set(roverId, { pressedSince: null, latched: false });
      }
      return;
    }
    if (state.pressedSince == null) state.pressedSince = now;
    if (!state.latched && now - state.pressedSince >= PRIVATE_BUTTON_HOLD_MS) {
      const nextOpen = !isPrivateOpen(record);
      try {
        setPrivateOpen(roverId, nextOpen, { reason: 'button_hold', tts: true });
      } catch (err) {
        logger.warn('Private button toggle failed', { roverId, error: err.message });
      }
      state.latched = true;
    }
    privateButtonStates.set(roverId, state);
  }

  function updateMovement(record, sensors) {
    if (!record || !sensors) return;
    const distance = Math.abs(sensors.distanceMm ?? 0);
    const angle = Math.abs(sensors.angleDeg ?? 0);
    const requested = Math.abs(sensors.requestedVelocity ?? 0);
    const requestedLeft = Math.abs(sensors.requestedLeftVelocity ?? 0);
    const requestedRight = Math.abs(sensors.requestedRightVelocity ?? 0);
    const moving = distance > 0 || angle > 0 || requested > 0 || requestedLeft > 0 || requestedRight > 0;
    if (moving) record.lastMovementAt = Date.now();
  }

  function getDockGuardState(roverId) {
    if (!dockGuardStates.has(roverId)) {
      dockGuardStates.set(roverId, {
        idleUndockedSince: null,
        passiveUndockedSince: null,
        active: false,
        reason: null,
        startedAt: null,
        timer: null,
      });
    }
    return dockGuardStates.get(roverId);
  }

  function stopDockGuard(roverId) {
    const state = dockGuardStates.get(roverId);
    if (!state) return;
    if (state.timer) clearInterval(state.timer);
    state.active = false;
    state.reason = null;
    state.startedAt = null;
    state.timer = null;
    state.idleUndockedSince = null;
    state.passiveUndockedSince = null;
  }

  function attemptDockGuard(roverId) {
    const record = rovers.get(roverId);
    if (!record) {
      stopDockGuard(roverId);
      return;
    }
    const { issueCommand } = require('../commandService');
    try {
      issueCommand(roverId, { type: 'sensorStream', sensorStream: { enable: true } });
      issueCommand(roverId, { type: 'raw', raw: DOCK_COMMAND_BASE64 });
    } catch (err) {
      logger.warn('Dock guard command failed', roverId, err.message);
    }
  }

  function startDockGuard(record, reason, idleMs) {
    if (!record) return;
    const state = getDockGuardState(record.id);
    if (state.active) return;
    state.active = true;
    state.reason = reason;
    state.startedAt = Date.now();
    const reasonText = reason === 'passive' ? 'passive mode' : 'idle and undocked';
    sendAlert({
      color: ALERT_COLOR,
      title: 'Dock Guard Triggered',
      message: `${record.id} ${reasonText}. Seeking dock and restarting sensors until movement.`,
    });
    publishEvent({
      source: 'roverManager',
      type: 'rover.dockGuard',
      payload: { roverId: record.id, reason, reasonText, idleMs },
    });
    attemptDockGuard(record.id);
    state.timer = setInterval(() => attemptDockGuard(record.id), DOCK_GUARD_RETRY_MS);
  }

  function evaluateDockGuard(record, sensors) {
    if (!record || !sensors) return;
    const state = getDockGuardState(record.id);
    const now = Date.now();
    const docked = Boolean(sensors?.chargingSources?.homeBase);
    const oiMode = sensors?.oiMode?.label || null;
    const idleMs = record.lastMovementAt ? now - record.lastMovementAt : 0;
    const isIdle = idleMs >= 1000;
    if (docked || record.drivers.size > 0 || !isIdle) state.idleUndockedSince = null;
    else if (!state.idleUndockedSince) state.idleUndockedSince = now;
    if (docked || oiMode !== 'passive' || !isIdle) state.passiveUndockedSince = null;
    else if (!state.passiveUndockedSince) state.passiveUndockedSince = now;
    if (state.active) {
      const shouldStop = docked || !isIdle || (state.reason === 'idle' && record.drivers.size > 0) || (state.reason === 'passive' && oiMode !== 'passive');
      if (shouldStop) stopDockGuard(record.id);
      return;
    }
    const idleReady = state.idleUndockedSince && now - state.idleUndockedSince >= IDLE_UNDOCKED_MS;
    const passiveReady = state.passiveUndockedSince && now - state.passiveUndockedSince >= PASSIVE_UNDOCKED_MS;
    if (passiveReady) startDockGuard(record, 'passive', idleMs);
    else if (idleReady) startDockGuard(record, 'idle', idleMs);
  }

  function nudgeRover(roverId, direction = 'backward') {
    if (!roverId) return;
    const { issueCommand } = require('../commandService');
    clearTimeout(backoffTimers.get(roverId));
    const speed = direction === 'forward' ? BACKOFF_SPEED : -BACKOFF_SPEED;
    try {
      issueCommand(roverId, { type: 'drive', driveDirect: { left: speed, right: speed } });
    } catch (err) {
      logger.warn('Dock protection nudge failed', roverId, err.message);
      return;
    }
    backoffTimers.set(
      roverId,
      setTimeout(() => {
        try {
          issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
        } catch (err) {
          logger.warn('Dock protection backoff stop failed', roverId, err.message);
        }
      }, BACKOFF_MS),
    );
  }

  function handleIdleUndock(undockedRecord) {
    if (!undockedRecord || undockedRecord.drivers.size > 0) return;
    const now = Date.now();
    const { getRecentDriveActivity, setDriveCooldown, issueCommand } = require('../commandService');
    const candidates = getRecentDriveActivity(DOCK_GUARD_WINDOW_MS, { excludeAdmins: true }).filter(
      (candidate) => candidate.roverId !== undockedRecord.id,
    );
    if (candidates.length === 0) return;
    const candidatesWithBump = candidates.filter((candidate) => {
      const record = rovers.get(candidate.roverId);
      return record?.lastBumpAt && now - record.lastBumpAt <= DOCK_GUARD_WINDOW_MS;
    });
    const pool = candidatesWithBump.length > 0 ? candidatesWithBump : candidates;
    pool.sort((a, b) => b.ts - a.ts);
    const suspect = pool[0];
    if (!suspect) return;
    const suspectRecord = rovers.get(suspect.roverId);
    if (!suspectRecord) return;
    const bumpRecent = suspectRecord.lastBumpAt && now - suspectRecord.lastBumpAt <= DOCK_GUARD_WINDOW_MS;
    sendAlert({
      color: ALERT_COLOR,
      title: 'Dock protection',
      message: `${undockedRecord.id} undocked while idle; stopping ${suspect.roverId}.`,
    });
    try {
      issueCommand(suspect.roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
      issueCommand(suspect.roverId, { type: 'motors', motorPwm: { main: 0, side: 0, vacuum: 0 } });
    } catch (err) {
      logger.warn('Dock protection stop failed', suspect.roverId, err.message);
    }
    setDriveCooldown(suspect.roverId, DOCK_GUARD_WINDOW_MS);
    if (bumpRecent) nudgeRover(suspect.roverId, 'backward');
    else nudgeRover(suspect.roverId, 'forward');
  }

  function handleSensorFrame(roverId, frame) {
    const record = rovers.get(roverId);
    if (!record) return;
    record.lastSeen = Date.now();
    const decoded = parseSensorFrame(frame.data);
    record.lastSensor = { raw: frame, decoded };
    record.batteryState = computeBatteryState(record, decoded);
    updateMovement(record, decoded);
    const hasDockInfo = decoded?.chargingSources != null;
    if (hasDockInfo) {
      const prevDocked = record.docked;
      const docked = Boolean(decoded?.chargingSources?.homeBase);
      record.docked = docked;
      if (prevDocked === true && docked === false) handleIdleUndock(record);
    }
    const bumps = decoded?.bumpsAndWheelDrops;
    if (bumps?.bumpLeft || bumps?.bumpRight) record.lastBumpAt = Date.now();
    handlePrivateButtonHold(record, decoded);
    evaluatePrivateSafety(record, decoded);
    io.to(record.room).volatile.emit('sensorFrame', { roverId, frame, sensors: decoded });
    managerEvents.emit('sensor', { roverId, sensors: decoded, batteryState: record.batteryState });
    evaluateDockGuard(record, decoded);
  }

  return {
    handleSensorFrame,
    applyPrivateDriveSafety,
    stopDockGuard,
  };
}

module.exports = {
  createSensorPipeline,
};
