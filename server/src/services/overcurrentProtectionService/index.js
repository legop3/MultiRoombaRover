// Overcurrent Protection Service
// Purpose: Owns fleet-wide, server-authoritative motor stress calculation and command limiting.
// Scope: Keeps overcurrent policy out of rover-manager sensor orchestration while combining command intent with decoded telemetry.

const logger = require('../../globals/logger').child('overcurrentProtectionService');

const DEFAULT_CONFIG = Object.freeze({
  minimumUsefulWheelIntent: 75,
  stressGrace: 0.25,
  wheelProgressWindowSec: 0.4,
  encoderNoiseFloorMmPerSec: 15,
  fullStallProgressRatio: 0.1,
  movingProgressRatio: 0.6,
  movingOrUnknownRatePerSec: 0.25,
  fullStallRatePerSec: 1,
  wheelRecoveryRatePerSec: 0.75,
  brushOvercurrentRatePerSec: 1,
  brushRecoveryRatePerSec: 0.75,
  clearBeforeUnlockSec: 0.75,
  outputRateMs: 250,
  maxTelemetryDeltaSec: 0.5,
});

const MOTOR_KEYS = Object.freeze(['leftWheel', 'rightWheel', 'mainBrush', 'sideBrush']);

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createMotorState() {
  return {
    overcurrent: false,
    commandedSpeed: 0,
    measuredSpeed: null,
    currentMa: null,
    stallFactor: 0,
    progressRatio: null,
    classification: 'unknown',
    progressSamples: [],
    windowCommandSign: 0,
    stress: 0,
    cap: 1,
  };
}

function createRoverState() {
  return {
    bypassed: false,
    lastTelemetryAt: 0,
    driveIntent: { left: 0, right: 0 },
    auxIntent: { main: 0, side: 0, vacuum: 0 },
    driveBlocked: false,
    requiresNeutral: false,
    neutralSeen: false,
    driveClearSec: 0,
    stopReason: null,
    lastDriveOutputAt: 0,
    lastAuxOutputAt: 0,
    lastDriveOutput: { left: 0, right: 0 },
    lastAuxOutput: { main: 0, side: 0, vacuum: 0 },
    motors: {
      leftWheel: createMotorState(),
      rightWheel: createMotorState(),
      mainBrush: createMotorState(),
      sideBrush: createMotorState(),
    },
  };
}

function createOvercurrentProtectionService(options = {}) {
  const config = Object.freeze({ ...DEFAULT_CONFIG, ...(options.config || {}) });
  const states = new Map();
  let commandIssuer = typeof options.issueCommand === 'function' ? options.issueCommand : null;

  function getState(roverId) {
    const key = String(roverId || '');
    if (!states.has(key)) states.set(key, createRoverState());
    return states.get(key);
  }

  function resetProtectionState(state, { bypassed = state.bypassed } = {}) {
    /*
      An administrator bypass is a change of authority, not merely a cap of
      one. Clearing accumulated stress here prevents a previous user's event
      from unexpectedly affecting the first command after authority changes.
      Both command intents are cleared before the caller records the new command
      so telemetry cannot apply a previous operator's held drive or brush value
      after authority changes.
    */
    state.bypassed = Boolean(bypassed);
    state.lastTelemetryAt = 0;
    state.driveBlocked = false;
    state.requiresNeutral = false;
    state.neutralSeen = false;
    state.driveClearSec = 0;
    state.stopReason = null;
    state.driveIntent = { left: 0, right: 0 };
    state.auxIntent = { main: 0, side: 0, vacuum: 0 };
    state.lastDriveOutput = { left: 0, right: 0 };
    state.lastAuxOutput = { main: 0, side: 0, vacuum: 0 };
    state.lastDriveOutputAt = 0;
    state.lastAuxOutputAt = 0;
    MOTOR_KEYS.forEach((key) => {
      state.motors[key] = createMotorState();
    });
  }

  function configureCommandIssuer(nextIssuer) {
    commandIssuer = typeof nextIssuer === 'function' ? nextIssuer : null;
  }

  function calculateCap(stress) {
    /*
      The grace region absorbs short mechanical events such as initial wheel
      acceleration and direction changes. Above it, the remaining stress range
      maps linearly to output so the cap reaches exactly zero at hard-stop
      stress instead of leaving a small command applied to a stalled motor.
    */
    const grace = clampUnit(config.stressGrace);
    if (stress <= grace) return 1;
    const usableRange = Math.max(0.0001, 1 - grace);
    return clampUnit(1 - (stress - grace) / usableRange);
  }

  function getDriveCap(state) {
    return Math.min(state.motors.leftWheel.cap, state.motors.rightWheel.cap);
  }

  function scaleDrive(state, driveDirect = state.driveIntent) {
    if (state.bypassed) return { ...driveDirect };
    if (state.driveBlocked) return { left: 0, right: 0 };
    const cap = getDriveCap(state);
    return {
      left: Math.round(finiteNumber(driveDirect?.left) * cap),
      right: Math.round(finiteNumber(driveDirect?.right) * cap),
    };
  }

  function scaleAux(state, motorPwm = state.auxIntent) {
    if (state.bypassed) return { ...motorPwm };
    return {
      main: Math.round(finiteNumber(motorPwm?.main) * state.motors.mainBrush.cap),
      side: Math.round(finiteNumber(motorPwm?.side) * state.motors.sideBrush.cap),
      // Create 2/Roomba 600 does not expose a vacuum overcurrent bit, so this
      // service must not imply that it can measure or limit vacuum motor stress.
      vacuum: Math.round(finiteNumber(motorPwm?.vacuum)),
    };
  }

  function hasDriveIntent(state) {
    return Boolean(state.driveIntent.left || state.driveIntent.right);
  }

  function hasAuxIntent(state) {
    return Boolean(state.auxIntent.main || state.auxIntent.side || state.auxIntent.vacuum);
  }

  function driveOutputsEqual(left, right) {
    return left.left === right.left && left.right === right.right;
  }

  function auxOutputsEqual(left, right) {
    return left.main === right.main && left.side === right.side && left.vacuum === right.vacuum;
  }

  function issueAdjustedCommand(roverId, payload) {
    if (!commandIssuer) return false;
    try {
      /*
        The injected issuer is the raw server-to-roverd transport function.
        Calling it here intentionally avoids routing a service-generated update
        through the socket authorization/filter path a second time.
      */
      return commandIssuer(roverId, payload) !== false;
    } catch (err) {
      logger.warn('Failed to issue overcurrent protection command', {
        roverId,
        type: payload?.type,
        error: err.message,
      });
      return false;
    }
  }

  function protectCommand(roverId, type, payload = {}, context = {}) {
    const state = getState(roverId);
    const bypassed = Boolean(context.bypassed);
    if (bypassed !== state.bypassed) {
      resetProtectionState(state, { bypassed });
    }

    if (type === 'drive' && payload?.driveDirect) {
      state.driveIntent = {
        left: finiteNumber(payload.driveDirect.left),
        right: finiteNumber(payload.driveDirect.right),
      };

      if (bypassed) {
        state.lastDriveOutput = { ...state.driveIntent };
        state.lastDriveOutputAt = Date.now();
        return { ...payload, driveDirect: { ...state.driveIntent } };
      }

      const neutral = !state.driveIntent.left && !state.driveIntent.right;
      if (neutral) {
        /*
          A real neutral command proves the operator released their controls.
          Merely observing zero encoder motion cannot provide that assurance,
          because a held command against an obstruction also produces no motion.
        */
        state.neutralSeen = true;
        if (state.driveBlocked && state.driveClearSec >= config.clearBeforeUnlockSec) {
          state.driveBlocked = false;
          state.requiresNeutral = false;
          state.stopReason = null;
        }
      }

      const driveDirect = scaleDrive(state);
      state.lastDriveOutput = { ...driveDirect };
      state.lastDriveOutputAt = Date.now();
      return { ...payload, driveDirect };
    }

    if (type === 'motors' && payload?.motorPwm) {
      state.auxIntent = {
        main: finiteNumber(payload.motorPwm.main),
        side: finiteNumber(payload.motorPwm.side),
        vacuum: finiteNumber(payload.motorPwm.vacuum),
      };
      const motorPwm = scaleAux(state);
      state.lastAuxOutput = { ...motorPwm };
      state.lastAuxOutputAt = Date.now();
      return { ...payload, motorPwm };
    }

    return payload;
  }

  function resetWheelProgressWindow(motor, commandSign = 0) {
    motor.progressSamples = [];
    motor.windowCommandSign = commandSign;
    motor.progressRatio = null;
    motor.classification = 'unknown';
    motor.stallFactor = 0;
  }

  function appendWheelProgressSample(motor, sample) {
    motor.progressSamples.push(sample);
    let windowSec = motor.progressSamples.reduce((total, entry) => total + entry.deltaSec, 0);

    /*
      Keep an actual rolling time window rather than periodically clearing a
      bucket. If the oldest sample crosses the boundary, retain only its
      proportional tail so classification does not depend on sensor cadence.
    */
    while (motor.progressSamples.length && windowSec > config.wheelProgressWindowSec) {
      const excessSec = windowSec - config.wheelProgressWindowSec;
      const oldest = motor.progressSamples[0];
      if (oldest.deltaSec <= excessSec) {
        motor.progressSamples.shift();
        windowSec -= oldest.deltaSec;
        continue;
      }
      const retainedFraction = (oldest.deltaSec - excessSec) / oldest.deltaSec;
      oldest.deltaSec -= excessSec;
      oldest.expectedDistance *= retainedFraction;
      oldest.alignedDistance *= retainedFraction;
      windowSec = config.wheelProgressWindowSec;
    }
    return windowSec;
  }

  function classifyWheelProgress(motor, windowSec) {
    if (windowSec < config.wheelProgressWindowSec * 0.9) return;
    const totals = motor.progressSamples.reduce(
      (result, sample) => ({
        expectedDistance: result.expectedDistance + sample.expectedDistance,
        alignedDistance: result.alignedDistance + sample.alignedDistance,
      }),
      { expectedDistance: 0, alignedDistance: 0 },
    );
    if (totals.expectedDistance <= 0) return;

    /*
      Signed, command-aligned distance lets forward/backward encoder wobble
      cancel over the window. The fixed noise floor then removes small residual
      bias from gearbox lash or a wheel module rocking without real travel.
    */
    const averageExpectedSpeed = totals.expectedDistance / windowSec;
    const averageAlignedSpeed = totals.alignedDistance / windowSec;
    const usefulProgressSpeed = Math.max(0, averageAlignedSpeed - config.encoderNoiseFloorMmPerSec);
    const progressRatio = clampUnit(usefulProgressSpeed / averageExpectedSpeed);
    const ratioRange = Math.max(0.0001, config.movingProgressRatio - config.fullStallProgressRatio);
    const stallFactor = clampUnit((config.movingProgressRatio - progressRatio) / ratioRange);

    motor.progressRatio = progressRatio;
    motor.stallFactor = stallFactor;
    motor.classification = progressRatio <= config.fullStallProgressRatio
      ? 'stalled'
      : progressRatio >= config.movingProgressRatio
        ? 'moving'
        : 'partial';
  }

  function updateWheelMotor(motor, { overcurrent, command, intent, measured, currentMa, deltaSec }) {
    const commandNumber = finiteNumber(command);
    const commandMagnitude = Math.abs(commandNumber);
    const commandSign = Math.sign(commandNumber);
    const intentMagnitude = Math.abs(finiteNumber(intent));
    // Null is intentionally checked before Number conversion because
    // Number(null) is zero, which would falsely turn missing telemetry into a
    // perfectly stalled wheel.
    const measuredNumber = measured == null ? null : Number(measured);
    const measuredValid = Number.isFinite(measuredNumber);
    const usefulIntent = intentMagnitude >= config.minimumUsefulWheelIntent;

    motor.overcurrent = Boolean(overcurrent);
    motor.commandedSpeed = commandNumber;
    motor.measuredSpeed = measuredValid ? measuredNumber : null;
    motor.currentMa = Number.isFinite(Number(currentMa)) ? Number(currentMa) : null;

    if (!motor.overcurrent) {
      resetWheelProgressWindow(motor, commandSign);
    } else if (!usefulIntent || commandMagnitude <= 0 || !measuredValid) {
      // Low commands and missing telemetry are real overcurrent events, but
      // neither supplies enough evidence to label the wheel mechanically stalled.
      // Raw operator intent decides whether the classifier remains meaningful;
      // the progressively smaller applied output must not erase an already
      // confirmed stall merely because protection itself reduced it below the
      // normal command threshold.
      resetWheelProgressWindow(motor, commandSign);
    } else {
      if (motor.windowCommandSign !== commandSign) {
        // Samples from opposite requested directions cannot share a progress
        // window because their aligned distances describe different motion.
        resetWheelProgressWindow(motor, commandSign);
      }
      if (deltaSec > 0) {
        const windowSec = appendWheelProgressSample(motor, {
          deltaSec,
          expectedDistance: commandMagnitude * deltaSec,
          alignedDistance: measuredNumber * commandSign * deltaSec,
        });
        classifyWheelProgress(motor, windowSec);
      }
    }

    const riseRate = config.movingOrUnknownRatePerSec
      + (config.fullStallRatePerSec - config.movingOrUnknownRatePerSec) * motor.stallFactor;
    motor.stress = clampUnit(
      motor.stress
        + (motor.overcurrent ? riseRate * deltaSec : -config.wheelRecoveryRatePerSec * deltaSec),
    );
    motor.cap = calculateCap(motor.stress);
  }

  function updateBrushMotor(motor, { overcurrent, command, currentMa, deltaSec }) {
    motor.overcurrent = Boolean(overcurrent);
    motor.commandedSpeed = finiteNumber(command);
    motor.measuredSpeed = null;
    motor.currentMa = Number.isFinite(Number(currentMa)) ? Number(currentMa) : null;
    motor.stallFactor = 0;
    motor.stress = clampUnit(
      motor.stress
        + (motor.overcurrent
          ? config.brushOvercurrentRatePerSec * deltaSec
          : -config.brushRecoveryRatePerSec * deltaSec),
    );
    motor.cap = calculateCap(motor.stress);
  }

  function maybeStopDrive(roverId, state) {
    if (state.bypassed || state.driveBlocked || !hasDriveIntent(state)) return;
    const stalledWheel = ['leftWheel', 'rightWheel'].find((key) => state.motors[key].stress >= 1);
    if (!stalledWheel) return;

    state.driveBlocked = true;
    state.requiresNeutral = true;
    state.neutralSeen = false;
    state.driveClearSec = 0;
    state.stopReason = stalledWheel;
    state.lastDriveOutputAt = Date.now();
    state.lastDriveOutput = { left: 0, right: 0 };
    issueAdjustedCommand(roverId, {
      type: 'drive',
      driveDirect: { left: 0, right: 0 },
    });
    logger.warn('Stopped rover after persistent wheel overcurrent', {
      roverId,
      motor: stalledWheel,
    });
  }

  function maybeResendScaledOutputs(roverId, state, now) {
    if (state.bypassed) return;

    /*
      A held keyboard/gamepad value may not emit another browser command while
      telemetry continues changing the cap. Rate-limited resends make each new
      server calculation effective without requiring the user to move the
      control again or flooding the Pi websocket at sensor-frame cadence.
    */
    const nextDriveOutput = scaleDrive(state);
    if (
      hasDriveIntent(state)
      && !state.driveBlocked
      && !driveOutputsEqual(nextDriveOutput, state.lastDriveOutput)
      && now - state.lastDriveOutputAt >= config.outputRateMs
    ) {
      const issued = issueAdjustedCommand(roverId, {
        type: 'drive',
        driveDirect: nextDriveOutput,
      });
      if (issued) {
        state.lastDriveOutputAt = now;
        state.lastDriveOutput = { ...nextDriveOutput };
      }
    }

    const nextAuxOutput = scaleAux(state);
    if (
      hasAuxIntent(state)
      && !auxOutputsEqual(nextAuxOutput, state.lastAuxOutput)
      && now - state.lastAuxOutputAt >= config.outputRateMs
    ) {
      const issued = issueAdjustedCommand(roverId, {
        type: 'motors',
        motorPwm: nextAuxOutput,
      });
      if (issued) {
        state.lastAuxOutputAt = now;
        state.lastAuxOutput = { ...nextAuxOutput };
      }
    }
  }

  function processTelemetry(roverId, sensors = {}, now = Date.now()) {
    const state = getState(roverId);
    const timestamp = finiteNumber(now, Date.now());
    const previousAt = state.lastTelemetryAt;
    state.lastTelemetryAt = timestamp;

    if (state.bypassed) {
      /*
        Admin bypass means telemetry remains visible but cannot build hidden
        stress or schedule a delayed stop. Motor observations are still copied
        into the public snapshot so administrators can see the hardware warning
        while deliberately retaining full control.
      */
      state.driveBlocked = false;
      state.requiresNeutral = false;
      state.neutralSeen = false;
      state.driveClearSec = 0;
      state.stopReason = null;
    }

    const rawDeltaSec = previousAt > 0 ? Math.max(0, (timestamp - previousAt) / 1000) : 0;
    const deltaSec = state.bypassed
      ? 0
      : Math.min(config.maxTelemetryDeltaSec, rawDeltaSec);
    const flags = sensors?.wheelOvercurrents || {};
    const speeds = sensors?.wheelSpeedsMmPerSecond || {};

    updateWheelMotor(state.motors.leftWheel, {
      overcurrent: flags.leftWheel,
      command: state.lastDriveOutput.left,
      intent: state.driveIntent.left,
      measured: speeds.left,
      currentMa: sensors?.wheelLeftCurrentMa,
      deltaSec,
    });
    updateWheelMotor(state.motors.rightWheel, {
      overcurrent: flags.rightWheel,
      command: state.lastDriveOutput.right,
      intent: state.driveIntent.right,
      measured: speeds.right,
      currentMa: sensors?.wheelRightCurrentMa,
      deltaSec,
    });
    updateBrushMotor(state.motors.mainBrush, {
      overcurrent: flags.mainBrush,
      command: state.auxIntent.main,
      currentMa: sensors?.mainBrushCurrentMa,
      deltaSec,
    });
    updateBrushMotor(state.motors.sideBrush, {
      overcurrent: flags.sideBrush,
      command: state.auxIntent.side,
      currentMa: sensors?.sideBrushCurrentMa,
      deltaSec,
    });

    const wheelOvercurrent = Boolean(flags.leftWheel || flags.rightWheel);
    state.driveClearSec = wheelOvercurrent ? 0 : state.driveClearSec + deltaSec;
    if (
      state.driveBlocked
      && state.neutralSeen
      && state.driveClearSec >= config.clearBeforeUnlockSec
    ) {
      state.driveBlocked = false;
      state.requiresNeutral = false;
      state.stopReason = null;
    }

    maybeStopDrive(roverId, state);
    maybeResendScaledOutputs(roverId, state, timestamp);
    return getPublicState(roverId);
  }

  function getStatus(state) {
    const anyOvercurrent = MOTOR_KEYS.some((key) => state.motors[key].overcurrent);
    if (state.bypassed && anyOvercurrent) return 'bypassed';
    if (state.driveBlocked) return 'stopped';
    const anyLimited = MOTOR_KEYS.some((key) => state.motors[key].cap < 1);
    if (anyLimited && anyOvercurrent) return 'limiting';
    // The raw Roomba flag is useful operator information even while stress is
    // still inside the transient grace region. Reporting it separately keeps
    // HUD visibility immediate without falsely claiming output is being scaled.
    if (anyOvercurrent) return 'overcurrent';
    if (anyLimited) return 'recovering';
    return 'idle';
  }

  function getPublicState(roverId) {
    const state = getState(roverId);
    const motors = MOTOR_KEYS.reduce((result, key) => {
      // Rolling samples are internal evidence, not UI state. Excluding them
      // keeps every sensor frame compact while exposing the resulting ratio and
      // classification needed to explain the service's decision.
      const { progressSamples: _progressSamples, windowCommandSign: _windowCommandSign, ...motor } = state.motors[key];
      result[key] = motor;
      return result;
    }, {});
    return {
      status: getStatus(state),
      bypassed: state.bypassed,
      drive: {
        cap: getDriveCap(state),
        blocked: state.driveBlocked,
        requiresNeutral: state.requiresNeutral,
        clearSec: state.driveClearSec,
        stopReason: state.stopReason,
      },
      motors,
      config: { ...config },
    };
  }

  function cleanupRover(roverId) {
    states.delete(String(roverId || ''));
  }

  return {
    configureCommandIssuer,
    protectCommand,
    processTelemetry,
    getPublicState,
    cleanupRover,
  };
}

const service = createOvercurrentProtectionService();

module.exports = {
  ...service,
  createOvercurrentProtectionService,
  DEFAULT_CONFIG,
};
