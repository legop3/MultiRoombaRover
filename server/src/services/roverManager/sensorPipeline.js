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
    dockProtectionStrikeStates,
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
    processOdometerFrame,
    isPrivateRecord,
    isPrivateOpen,
    getPrivateSafety,
    setPrivateOpen,
    shouldApplyPrivateSafety,
    shouldApplyPrivateSensorSafety,
  } = deps;

  const DOCK_PROTECTION_MAX_STRIKES = 3;
  const DOCK_PROTECTION_STRIKE_RESET_MS = 5 * 60 * 1000;

  function getPrivateSafetyState(roverId) {
    if (!privateSafetyStates.has(roverId)) {
      privateSafetyStates.set(roverId, {
        blockedUntil: 0,
        lastOvercurrent: false,
        lastBump: false,
        lastCliff: false,
        lastVirtualWall: false,
        lastDriveDirection: null,
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
    const explicitBackoffDrive = options.backoffDrive && typeof options.backoffDrive === 'object'
      ? options.backoffDrive
      : null;
    const notify = options.notify !== false;
    try {
      issueCommand(roverId, { type: 'drive', driveDirect: { left: 0, right: 0 } });
      issueCommand(roverId, { type: 'motors', motorPwm: { main: 0, side: 0, vacuum: 0 } });
    } catch (err) {
      logger.warn('Private safety stop failed', { roverId, mode, error: err.message });
    }
    stopSafetyBackoffTimer(roverId);
    if (backoffMs > 0 && (backoffSpeed > 0 || explicitBackoffDrive)) {
      // Bump and cliff safety only need a simple straight reverse. Virtual wall
      // safety can be hit while turning or arcing, so it may pass an explicit
      // per-wheel escape command that reverses the last commanded wheel signs.
      const speed = Math.max(SAFETY_BACKOFF_MIN, Math.min(SAFETY_BACKOFF_MAX, -Math.abs(backoffSpeed)));
      const backoffDrive = explicitBackoffDrive || { left: speed, right: speed };
      try {
        issueCommand(roverId, { type: 'drive', driveDirect: backoffDrive });
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
    if (notify) {
      sendAlert({
        color: ALERT_COLOR,
        title: 'Private Safety',
        message: `${roverId} ${mode} safety triggered.`,
      });
      publishEvent({
        source: 'roverManager',
        type: 'rover.privateSafetyTriggered',
        payload: { roverId, mode, cooldownMs, backoffMs, backoffSpeed, backoffDrive: explicitBackoffDrive },
      });
    }
  }

  function rememberPrivateDriveDirection(roverId, driveDirect = null) {
    if (!roverId || !driveDirect || typeof driveDirect !== 'object') return;
    const left = clampInt(driveDirect.left, -500, 500, 0);
    const right = clampInt(driveDirect.right, -500, 500, 0);
    if (left === 0 && right === 0) return;
    const state = getPrivateSafetyState(String(roverId));
    // Store signs instead of raw speeds because safety escape speed is its own
    // configured value. The thing we need from the driver command is direction,
    // not magnitude, so later speed-limit changes cannot make the remembered
    // state stale or unsafe.
    state.lastDriveDirection = {
      left: Math.sign(left),
      right: Math.sign(right),
      updatedAt: Date.now(),
    };
  }

  function getOppositePrivateDrive(record, speed) {
    const state = getPrivateSafetyState(record.id);
    const direction = state.lastDriveDirection || null;
    const safeSpeed = clampInt(speed, 1, 500, DEFAULT_PRIVATE_SAFETY.virtualWallBackoffSpeed);
    if (!direction) {
      // If the rover has not received a remembered drive command yet, straight
      // reverse is the least surprising escape because virtual walls are meant
      // to block forward travel into a restricted area.
      return { left: -safeSpeed, right: -safeSpeed };
    }

    let leftSign = Number(direction.left) || 0;
    let rightSign = Number(direction.right) || 0;
    if (leftSign === 0 && rightSign === 0) {
      leftSign = 1;
      rightSign = 1;
    } else if (leftSign === 0) {
      leftSign = rightSign;
    } else if (rightSign === 0) {
      rightSign = leftSign;
    }
    return {
      left: -leftSign * safeSpeed,
      right: -rightSign * safeSpeed,
    };
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
    const virtualWall = Boolean(sensors?.virtualWall);
    const currentOver = overcurrent;
    const currentBump = bump;
    const currentCliff = cliff;
    const currentVirtualWall = virtualWall;
    if (!shouldApplyPrivateSensorSafety(record)) {
      state.blockedUntil = 0;
      state.lastOvercurrent = currentOver;
      state.lastBump = currentBump;
      state.lastCliff = currentCliff;
      state.lastVirtualWall = currentVirtualWall;
      return;
    }
    const safety = getPrivateSafety(record);
    const now = Date.now();
    if (safety.virtualWallEnabled && currentVirtualWall) {
      const wasAlreadyBlocked = now < Number(state.blockedUntil || 0);
      /*
        Virtual walls are different from bump/cliff edges: staying in the beam
        is itself unsafe, so the guard must keep asserting the stop/backoff
        command even while the normal private-safety cooldown is active. The
        repeated command path is intentional; only duplicate alerts/events are
        suppressed during the existing blocked window so a held wall signal does
        not flood chat/log surfaces at sensor-frame rate.
      */
      triggerSafetyAction(record, 'virtualWall', {
        cooldownMs: safety.triggerCooldownMs,
        backoffMs: safety.virtualWallBackoffMs,
        backoffSpeed: safety.virtualWallBackoffSpeed,
        backoffDrive: getOppositePrivateDrive(record, safety.virtualWallBackoffSpeed),
        notify: !wasAlreadyBlocked,
      });
      state.lastOvercurrent = currentOver;
      state.lastBump = currentBump;
      state.lastCliff = currentCliff;
      state.lastVirtualWall = currentVirtualWall;
      return;
    }
    if (now < Number(state.blockedUntil || 0)) {
      state.lastOvercurrent = currentOver;
      state.lastBump = currentBump;
      state.lastCliff = currentCliff;
      state.lastVirtualWall = currentVirtualWall;
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
    state.lastVirtualWall = currentVirtualWall;
  }

  function applyPrivateDriveSafety(roverId, socket, driveDirect = null) {
    const record = rovers.get(String(roverId));
    if (!record || !driveDirect || typeof driveDirect !== 'object') return driveDirect;
    if (!shouldApplyPrivateSafety(record, socket)) return driveDirect;
    const safety = getPrivateSafety(record);
    if (!safety.speedLimitEnabled) {
      rememberPrivateDriveDirection(roverId, driveDirect);
      return driveDirect;
    }
    const limit = clampInt(safety.speedLimitMaxWheelSpeed, 1, 500, DEFAULT_PRIVATE_SAFETY.speedLimitMaxWheelSpeed);
    const left = clampInt(driveDirect.left, -500, 500, 0);
    const right = clampInt(driveDirect.right, -500, 500, 0);
    const safeDrive = {
      ...driveDirect,
      left: Math.max(-limit, Math.min(limit, left)),
      right: Math.max(-limit, Math.min(limit, right)),
    };
    rememberPrivateDriveDirection(roverId, safeDrive);
    return safeDrive;
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

  function getDockProtectionStrikeState(socketId) {
    /*
      The strike record is keyed by driver socket because the moderation action
      removes a person from control, not a rover from service. The last rover is
      still tracked so "three in a row" means repeated bump-off-dock incidents
      by the same browser session without a different rover resetting context.
    */
    const key = String(socketId || '').trim();
    if (!key) return null;
    if (!dockProtectionStrikeStates.has(key)) {
      dockProtectionStrikeStates.set(key, {
        count: 0,
        lastRoverId: null,
        updatedAt: 0,
      });
    }
    return dockProtectionStrikeStates.get(key);
  }

  function recordDockProtectionStrike(suspect) {
    const socketId = String(suspect?.socketId || '').trim();
    const roverId = String(suspect?.roverId || '').trim();
    const state = getDockProtectionStrikeState(socketId);
    if (!state || !roverId) return 0;
    const now = Date.now();
    const previousIsFresh = state.updatedAt && now - state.updatedAt <= DOCK_PROTECTION_STRIKE_RESET_MS;
    /*
      Consecutive protection hits should punish repeated behavior, not stale
      memory from some unrelated rover interaction. Switching suspect rover
      resets the count because the dock-protection heuristic has a different
      physical context and should earn its own three-strike sequence.
    */
    state.count = previousIsFresh && state.lastRoverId === roverId ? state.count + 1 : 1;
    state.lastRoverId = roverId;
    state.updatedAt = now;
    return state.count;
  }

  function clearDockProtectionStrikes(socketId) {
    const key = String(socketId || '').trim();
    if (key) dockProtectionStrikeStates.delete(key);
  }

  function removeDriverForDockProtection(suspect, strikes) {
    const socketId = String(suspect?.socketId || '').trim();
    const roverId = String(suspect?.roverId || '').trim();
    if (!socketId || !roverId) return false;
    const assignmentService = require('../assignmentService');
    /*
      Release through assignmentService so rover membership, turn queues, and
      the browser-facing removal notice all move together. Directly editing
      roverManager sets here would skip queue cleanup and produce stale UI.
    */
    assignmentService.forceReleaseWithNotice(roverId, socketId, {
      title: 'Removed for dock protection',
      message: `You were removed from ${roverId} after triggering bump-off-dock protection ${strikes} times in a row.`,
      reasonCode: 'dock-protection',
    });
    clearDockProtectionStrikes(socketId);
    return true;
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
    const strikes = recordDockProtectionStrike(suspect);
    sendAlert({
      color: ALERT_COLOR,
      title: 'Dock protection',
      message: `${undockedRecord.id} undocked while idle; stopping ${suspect.roverId}${strikes ? ` (${strikes}/${DOCK_PROTECTION_MAX_STRIKES})` : ''}.`,
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
    if (strikes >= DOCK_PROTECTION_MAX_STRIKES && removeDriverForDockProtection(suspect, strikes)) {
      sendAlert({
        color: ALERT_COLOR,
        title: 'Driver removed',
        message: `${suspect.socketId} removed from ${suspect.roverId} after ${strikes} dock-protection triggers.`,
      });
    }
  }

  function handleSensorFrame(roverId, frame) {
    const record = rovers.get(roverId);
    if (!record) return;
    record.lastSeen = Date.now();
    const decoded = parseSensorFrame(frame.data);
    record.lastSensor = { raw: frame, decoded };
    record.batteryState = computeBatteryState(record, decoded);
    if (typeof processOdometerFrame === 'function') {
      processOdometerFrame(roverId, decoded);
    }
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
