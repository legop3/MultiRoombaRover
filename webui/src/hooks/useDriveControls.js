import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSession } from '../context/SessionContext.jsx';

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

export function useDriveControls() {
  const socket = useSocket();
  const { session } = useSession();
  const roverId = session?.assignment?.roverId;
  const keysRef = useRef(new Set());
  const lastSpeedsRef = useRef({ left: 0, right: 0 });
  const [currentSpeeds, setCurrentSpeeds] = useState(lastSpeedsRef.current);
  const [sensorEnabled, setSensorEnabled] = useState(false);

  const emitCommand = useCallback(
    (payload, cb) => {
      if (!roverId) return;
      socket.emit('command', { roverId, ...payload }, cb);
    },
    [socket, roverId],
  );

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

  const toggleSensorStream = useCallback(() => {
    if (!roverId) return;
    setSensorEnabled((prev) => {
      const next = !prev;
      emitCommand({
        type: 'sensorStream',
        data: { sensorStream: { enable: next } },
      });
      return next;
    });
  }, [emitCommand, roverId]);

  useEffect(() => {
    if (!roverId) {
      keysRef.current.clear();
      lastSpeedsRef.current = { left: 0, right: 0 };
      setCurrentSpeeds(lastSpeedsRef.current);
      setSensorEnabled(false);
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

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [roverId, sendDriveUpdate]);

  return {
    roverId,
    speeds: currentSpeeds,
    sensorEnabled,
    toggleSensorStream,
    stopMotors,
  };
}
