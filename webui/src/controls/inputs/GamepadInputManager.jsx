import { useCallback, useEffect, useRef } from 'react';
import { useControlSystem } from '../ControlContext.jsx';
import { clampUnit } from '../controlMath.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';

const SOURCE = 'gamepad';

function applyDeadzone(value, amount) {
  return Math.abs(value) < amount ? 0 : value;
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
  const { value: inputSettings } = useSettingsNamespace('inputs', INPUT_SETTINGS_DEFAULTS);
  const gamepadSettings = inputSettings.gamepad ?? INPUT_SETTINGS_DEFAULTS.gamepad;
  const driveDeadzone = Math.min(Math.max(gamepadSettings.driveDeadzone ?? 0.2, 0), 0.8);
  const cameraDeadzone = Math.min(Math.max(gamepadSettings.cameraDeadzone ?? 0.25, 0), 0.9);
  const servoStep = gamepadSettings.servoStep ?? INPUT_SETTINGS_DEFAULTS.gamepad.servoStep;
  const auxReverseScale = gamepadSettings.auxReverseScale ?? INPUT_SETTINGS_DEFAULTS.gamepad.auxReverseScale;
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

    const axisLX = clampUnit(applyDeadzone(pad.axes?.[0] ?? 0, driveDeadzone));
    const axisLY = clampUnit(applyDeadzone(-(pad.axes?.[1] ?? 0), driveDeadzone));
    const vector = { x: axisLX, y: axisLY, boost: false };
    if (!vectorsEqual(vector, lastVectorRef.current)) {
      lastVectorRef.current = vector;
      setDriveVector(vector, { source: SOURCE });
    }

    const main = computeTriggerSpeed(pad.buttons?.[7], pad.buttons?.[5]);
    const side = computeTriggerSpeed(pad.buttons?.[6], pad.buttons?.[4], 127, auxReverseScale);
    const vacuum = pad.buttons?.[1]?.pressed ? 127 : 0;
    let aux = { main, side, vacuum };
    if (pad.buttons?.[0]?.pressed) {
      aux = { main: 127, side: 127, vacuum: 127 };
    }
    if (!auxEqual(aux, lastAuxRef.current)) {
      lastAuxRef.current = aux;
      setAuxMotors(aux);
    }

    const cameraAxis = clampUnit(applyDeadzone(-(pad.axes?.[3] ?? 0), cameraDeadzone));
    const now = performance.now();
    if (Math.abs(cameraAxis) > 0.25 && now - servoThrottleRef.current > 120) {
      servoThrottleRef.current = now;
      nudgeServo(cameraAxis > 0 ? servoStep : -servoStep);
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
  }, [
    auxReverseScale,
    cameraDeadzone,
    driveDeadzone,
    handleButtonEdge,
    nudgeServo,
    registerInputState,
    runMacro,
    servoStep,
    setAuxMotors,
    setDriveVector,
    setMode,
  ]);

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
