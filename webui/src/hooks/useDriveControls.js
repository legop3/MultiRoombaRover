import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSession } from '../context/SessionContext.jsx';

const OI_COMMANDS = {
  start: [128],
  safe: [131],
  full: [132],
  passive: [128],
  dock: [143],
};

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
  return Buffer.from(bytes).toString('base64');
}

export function useDriveControls() {
  const socket = useSocket();
  const { session } = useSession();
  const roverId = session?.assignment?.roverId;
  const keysRef = useRef(new Set());
  const lastSpeedsRef = useRef({ left: 0, right: 0 });
  const [currentSpeeds, setCurrentSpeeds] = useState(lastSpeedsRef.current);

  const emitCommand = useCallback(
    (payload, cb) => {
      if (!roverId) return;
      socket.emit('command', { roverId, ...payload }, cb);
    },
    [socket, roverId],
  );

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

  const stopMotors = useCallback(() => {
    if (!roverId) return;
    keysRef.current.clear();
    lastSpeedsRef.current = { left: 0, right: 0 };
    setCurrentSpeeds(lastSpeedsRef.current);
    emitCommand({
      type: 'motors',
      data: { motorPwm: { main: 0, side: 0, vacuum: 0 } },
    });
  }, [emitCommand, roverId]);

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
  };
}
