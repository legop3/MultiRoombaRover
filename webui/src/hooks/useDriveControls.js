/* global Buffer */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSession } from '../context/SessionContext.jsx';

const OI_COMMANDS = {
  start: [128],
  safe: [131],
  full: [132],
  passive: [128],
  dock: [143],
};

const AUX_LIMITS = {
  main: [-127, 127],
  side: [-127, 127],
  vacuum: [0, 127],
};

const COMMAND_DELAY_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeSpeeds(keys) {
  const forward = keys.has('w');
  const backward = keys.has('s');
  const left = keys.has('a');
  const right = keys.has('d');
  const fast = keys.has('shift');
  const base = fast ? 300 : 150;
  let leftSpeed = 0;
  let rightSpeed = 0;

  if (forward && !backward) {
    leftSpeed += base;
    rightSpeed += base;
  } else if (backward && !forward) {
    leftSpeed -= base;
    rightSpeed -= base;
  }

  if (left && !right) {
    leftSpeed -= base;
    rightSpeed += base;
  } else if (right && !left) {
    leftSpeed += base;
    rightSpeed -= base;
  }

  if (!forward && !backward && (left || right)) {
    leftSpeed = left ? -base : base;
    rightSpeed = left ? base : -base;
  }

  return {
    left: clamp(leftSpeed, -500, 500),
    right: clamp(rightSpeed, -500, 500),
  };
}

function clampUnit(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function shouldIgnoreEvent(event) {
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable ||
    (tag === 'SELECT' && ['w', 'a', 's', 'd', 'Shift'].includes(event.key))
  );
}

function bytesToBase64(bytes) {
  const binary = String.fromCharCode(...bytes);
  if (typeof btoa === 'function') return btoa(binary);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  throw new Error('No base64 encoder available');
}

export function useDriveControls() {
  const socket = useSocket();
  const { session } = useSession();
  const roverId = session?.assignment?.roverId;
  const keysRef = useRef(new Set());
  const lastSpeedsRef = useRef({ left: 0, right: 0 });
  const [currentSpeeds, setCurrentSpeeds] = useState(() => ({ left: 0, right: 0 }));
  const [servoAngle, setServoAngle] = useState(null);

  const emitCommand = useCallback(
    (payload, cb) => {
      if (!roverId) return;
      socket.emit('command', { roverId, ...payload }, cb);
    },
    [socket, roverId],
  );

  const currentRosterEntry = useMemo(() => {
    if (!roverId || !Array.isArray(session?.roster)) return null;
    return session.roster.find((entry) => String(entry.id) === String(roverId)) || null;
  }, [roverId, session?.roster]);

  const servoConfig = useMemo(() => {
    if (!currentRosterEntry?.cameraServo || !currentRosterEntry.cameraServo.enabled) {
      return null;
    }
    return currentRosterEntry.cameraServo;
  }, [currentRosterEntry]);

  const enableSensorStream = useCallback(() => {
    if (!roverId) return;
    emitCommand({
      type: 'sensorStream',
      data: { sensorStream: { enable: true } },
    });
  }, [emitCommand, roverId]);

  const sendDriveUpdate = useCallback(() => {
    if (!roverId) return;
    const speeds = computeSpeeds(keysRef.current);
    const last = lastSpeedsRef.current;
    if (speeds.left === last.left && speeds.right === last.right) return;
    lastSpeedsRef.current = speeds;
    setCurrentSpeeds(speeds);
    emitCommand({
      type: 'drive',
      data: { driveDirect: speeds },
    });
  }, [emitCommand, roverId]);

  const driveWithVector = useCallback(
    ({ x = 0, y = 0, boost = false } = {}) => {
      if (!roverId) return;
      const base = boost ? 400 : 250;
      const forward = clampUnit(y) * base;
      const turn = clampUnit(x) * base;
      const speeds = {
        left: clamp(Math.round(forward + turn), -500, 500),
        right: clamp(Math.round(forward - turn), -500, 500),
      };
      lastSpeedsRef.current = speeds;
      setCurrentSpeeds(speeds);
      emitCommand({
        type: 'drive',
        data: { driveDirect: speeds },
      });
    },
    [emitCommand, roverId],
  );

  const sendMotorPwm = useCallback(
    ({ main = 0, side = 0, vacuum = 0 } = {}) => {
      if (!roverId) return;
      const payload = {
        main: clamp(main, AUX_LIMITS.main[0], AUX_LIMITS.main[1]),
        side: clamp(side, AUX_LIMITS.side[0], AUX_LIMITS.side[1]),
        vacuum: clamp(vacuum, AUX_LIMITS.vacuum[0], AUX_LIMITS.vacuum[1]),
      };
      emitCommand({
        type: 'motors',
        data: { motorPwm: payload },
      });
    },
    [emitCommand, roverId],
  );

  const stopMotors = useCallback(() => {
    if (!roverId) return;
    keysRef.current.clear();
    lastSpeedsRef.current = { left: 0, right: 0 };
    setCurrentSpeeds(lastSpeedsRef.current);
    sendMotorPwm({ main: 0, side: 0, vacuum: 0 });
  }, [roverId, sendMotorPwm]);

  const sendOiCommand = useCallback(
    (key) => {
      if (!roverId) return;
      const bytes = OI_COMMANDS[key];
      if (!bytes) return;
      emitCommand({
        type: 'raw',
        data: { raw: bytesToBase64(bytes) },
      });
      enableSensorStream();
    },
    [emitCommand, enableSensorStream, roverId],
  );

  const runStartDockFull = useCallback(async () => {
    if (!roverId) return;
    for (const key of ['start', 'dock', 'full']) {
      sendOiCommand(key);
      // brief pause so the commands aren't collapsed by the rover
      await sleep(COMMAND_DELAY_MS);
    }
  }, [roverId, sendOiCommand]);

  const seekDock = useCallback(() => {
    sendOiCommand('dock');
  }, [sendOiCommand]);

  const setAuxMotors = useCallback(
    (values) => {
      if (!roverId) return;
      sendMotorPwm(values);
    },
    [roverId, sendMotorPwm],
  );

  const sendServoCommand = useCallback(
    (payload) => {
      if (!roverId || !servoConfig) return;
      emitCommand({
        type: 'servo',
        data: { servo: payload },
      });
    },
    [emitCommand, roverId, servoConfig],
  );

  const applyServoAngle = useCallback(
    (angle) => {
      if (!servoConfig) return;
      const min = typeof servoConfig.minAngle === 'number' ? servoConfig.minAngle : -45;
      const max = typeof servoConfig.maxAngle === 'number' ? servoConfig.maxAngle : 45;
      const clamped = clamp(angle, min, max);
      setServoAngle(clamped);
      sendServoCommand({ angle: clamped });
    },
    [sendServoCommand, servoConfig],
  );

  const nudgeServo = useCallback(
    (delta) => {
      if (!servoConfig) return;
      const min = typeof servoConfig.minAngle === 'number' ? servoConfig.minAngle : -45;
      const max = typeof servoConfig.maxAngle === 'number' ? servoConfig.maxAngle : 45;
      const midpoint = (min + max) / 2;
      const step =
        typeof delta === 'number' && !Number.isNaN(delta) && delta !== 0
          ? delta
          : servoConfig.nudgeDegrees || 1;
      const baseline =
        typeof servoAngle === 'number'
          ? servoAngle
          : servoConfig.homeAngle ?? midpoint;
      applyServoAngle(baseline + step);
    },
    [applyServoAngle, servoAngle, servoConfig],
  );

  useEffect(() => {
    if (!servoConfig) {
      setServoAngle(null);
      return;
    }
    const min = typeof servoConfig.minAngle === 'number' ? servoConfig.minAngle : -45;
    const max = typeof servoConfig.maxAngle === 'number' ? servoConfig.maxAngle : 45;
    const initial =
      typeof servoConfig.homeAngle === 'number' ? servoConfig.homeAngle : (min + max) / 2;
    setServoAngle(clamp(initial, min, max));
  }, [servoConfig, roverId]);

  useEffect(() => {
    if (!roverId) {
      keysRef.current.clear();
      lastSpeedsRef.current = { left: 0, right: 0 };
      setCurrentSpeeds(lastSpeedsRef.current);
      return undefined;
    }

    function onKeyDown(event) {
      if (shouldIgnoreEvent(event)) return;
      const key = event.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'shift'].includes(key)) return;
      if (keysRef.current.has(key)) return;
      keysRef.current.add(key);
      sendDriveUpdate();
    }

    function onKeyUp(event) {
      const key = event.key.toLowerCase();
      if (!keysRef.current.has(key)) return;
      keysRef.current.delete(key);
      sendDriveUpdate();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    enableSensorStream();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [roverId, sendDriveUpdate, enableSensorStream]);

  return {
    roverId,
    speeds: currentSpeeds,
    stopMotors,
    sendOiCommand,
    runStartDockFull,
    seekDock,
    setAuxMotors,
    driveWithVector,
    servo: {
      enabled: Boolean(roverId && servoConfig),
      config: servoConfig,
      angle:
        typeof servoAngle === 'number'
          ? servoAngle
          : servoConfig?.homeAngle ?? servoConfig?.minAngle ?? 0,
      setAngle: applyServoAngle,
      nudge: nudgeServo,
      goHome: () => {
        if (!servoConfig) return;
        applyServoAngle(servoConfig.homeAngle ?? 0);
      },
    },
  };
}
