import { useCallback, useEffect, useRef } from 'react';
import { useControlSystem } from '../ControlContext.jsx';
import { clampUnit } from '../controlMath.js';

const SOURCE = 'gamepad';
const DEADZONE = 0.2;

function applyDeadzone(value) {
  return Math.abs(value) < DEADZONE ? 0 : value;
}

function computeTriggerSpeed(button, reverseButton, max = 127, reverseScale = 1) {
  if (!button) return 0;
  const value = typeof button.value === 'number' ? button.value : button.pressed ? 1 : 0;
  if (value < 0.05) return 0;
  const direction = reverseButton?.pressed ? -1 : 1;
  return Math.round(value * max * direction * reverseScale);
}

function vectorsEqual(a, b) {
  return (
    a &&
    b &&
    a.x === b.x &&
    a.y === b.y &&
    a.boost === b.boost
  );
}

function auxEqual(a, b) {
  return a && b && a.main === b.main && a.side === b.side && a.vacuum === b.vacuum;
}

export default function GamepadInputManager() {
  const {
    actions: {
      setMode,
      setDriveVector,
      setAuxMotors,
      nudgeServo,
      runMacro,
      registerInputState,
    },
  } = useControlSystem();
  const rafRef = useRef(null);
  const lastVectorRef = useRef({ x: 0, y: 0, boost: false });
  const lastAuxRef = useRef({ main: 0, side: 0, vacuum: 0 });
  const buttonStateRef = useRef(new Map());
  const servoThrottleRef = useRef(0);

  const handleButtonEdge = useCallback(
    (index, pressed) => {
      const prev = buttonStateRef.current.get(index) || false;
      buttonStateRef.current.set(index, pressed);
      return pressed && !prev;
    },
    [],
  );

  const pollGamepads = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      return;
    }
    const pads = navigator.getGamepads();
    const pad = pads && Array.from(pads).find(Boolean);
    if (!pad) {
      if (!vectorsEqual(lastVectorRef.current, { x: 0, y: 0, boost: false })) {
        lastVectorRef.current = { x: 0, y: 0, boost: false };
        setDriveVector({ x: 0, y: 0, boost: false }, { source: SOURCE });
      }
      if (!auxEqual(lastAuxRef.current, { main: 0, side: 0, vacuum: 0 })) {
        lastAuxRef.current = { main: 0, side: 0, vacuum: 0 };
        setAuxMotors({ main: 0, side: 0, vacuum: 0 });
      }
      registerInputState(SOURCE, { connected: false });
      return;
    }

    const axisLX = clampUnit(applyDeadzone(pad.axes?.[0] ?? 0));
    const axisLY = clampUnit(applyDeadzone(-(pad.axes?.[1] ?? 0)));
    const vector = { x: axisLX, y: axisLY, boost: false };
    if (!vectorsEqual(vector, lastVectorRef.current)) {
      lastVectorRef.current = vector;
      setDriveVector(vector, { source: SOURCE });
    }

    const main = computeTriggerSpeed(pad.buttons?.[7], pad.buttons?.[5]);
    const side = computeTriggerSpeed(pad.buttons?.[6], pad.buttons?.[4], 127, 0.55);
    const vacuum = pad.buttons?.[1]?.pressed ? 127 : 0;
    let aux = { main, side, vacuum };
    if (pad.buttons?.[0]?.pressed) {
      aux = { main: 127, side: 127, vacuum: 127 };
    }
    if (!auxEqual(aux, lastAuxRef.current)) {
      lastAuxRef.current = aux;
      setAuxMotors(aux);
    }

    const cameraAxis = clampUnit(applyDeadzone(-(pad.axes?.[3] ?? 0)));
    const now = performance.now();
    if (Math.abs(cameraAxis) > 0.25 && now - servoThrottleRef.current > 120) {
      servoThrottleRef.current = now;
      nudgeServo(cameraAxis > 0 ? 2 : -2);
    }

    if (handleButtonEdge(14, pad.buttons?.[14]?.pressed)) {
      setMode('drive');
      runMacro('drive-sequence');
    }
    if (handleButtonEdge(15, pad.buttons?.[15]?.pressed)) {
      setMode('dock');
      runMacro('seek-dock');
    }

    registerInputState(SOURCE, {
      connected: true,
      id: pad.id,
      index: pad.index,
      axes: [axisLX, axisLY, cameraAxis],
      buttons: {
        a: pad.buttons?.[0]?.pressed || false,
        b: pad.buttons?.[1]?.pressed || false,
        lb: pad.buttons?.[4]?.pressed || false,
        rb: pad.buttons?.[5]?.pressed || false,
      },
    });
  }, [handleButtonEdge, nudgeServo, registerInputState, runMacro, setAuxMotors, setDriveVector, setMode]);

  useEffect(() => {
    function loop() {
      pollGamepads();
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [pollGamepads]);

  return null;
}
