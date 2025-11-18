import { useCallback, useEffect, useRef } from 'react';
import { useControlSystem } from '../ControlContext.jsx';
import { clampUnit } from '../controlMath.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS, GAMEPAD_MAPPING_DEFAULT } from '../../settings/namespaces.js';

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
  const { value: mapping } = useSettingsNamespace('gamepadMapping', GAMEPAD_MAPPING_DEFAULT);
  const gamepadSettings = inputSettings.gamepad ?? INPUT_SETTINGS_DEFAULTS.gamepad;
  const driveDeadzone = Math.min(Math.max(gamepadSettings.driveDeadzone ?? 0.2, 0), 0.8);
  const cameraDeadzone = Math.min(Math.max(gamepadSettings.cameraDeadzone ?? 0.25, 0), 0.9);
  const servoStep = gamepadSettings.servoStep ?? INPUT_SETTINGS_DEFAULTS.gamepad.servoStep;
  const auxReverseScale = gamepadSettings.auxReverseScale ?? INPUT_SETTINGS_DEFAULTS.gamepad.auxReverseScale;
  const mappingReady =
    Boolean(mapping?.drive?.horizontal) &&
    Boolean(mapping?.drive?.vertical) &&
    Boolean(mapping?.camera?.vertical) &&
    Boolean(mapping?.triggers?.main) &&
    Boolean(mapping?.triggers?.side) &&
    Boolean(mapping?.buttons?.mainReverse) &&
    Boolean(mapping?.buttons?.sideReverse) &&
    Boolean(mapping?.buttons?.vacuum) &&
    Boolean(mapping?.buttons?.allAux) &&
    Boolean(mapping?.buttons?.driveMacro) &&
    Boolean(mapping?.buttons?.dockMacro);
  const rafRef = useRef(null);
  const lastVectorRef = useRef({ x: 0, y: 0, boost: false });
  const lastAuxRef = useRef({ main: 0, side: 0, vacuum: 0 });
  const buttonStateRef = useRef(new Map());
  const servoThrottleRef = useRef(0);

  const handleButtonEdge = useCallback((key, pressed) => {
    const prev = buttonStateRef.current.get(key) || false;
    buttonStateRef.current.set(key, pressed);
    return pressed && !prev;
  }, []);

  const getAxisValue = useCallback((pad, descriptor) => {
    if (!descriptor) return 0;
    const raw = pad.axes?.[descriptor.index] ?? 0;
    return descriptor.invert ? -raw : raw;
  }, []);

  const getButtonValue = useCallback((pad, descriptor) => {
    if (!descriptor) return 0;
    const btn = pad.buttons?.[descriptor.index];
    if (!btn) return 0;
    return typeof btn.value === 'number' ? btn.value : btn.pressed ? 1 : 0;
  }, []);

  const isButtonPressed = useCallback((pad, descriptor) => {
    if (!descriptor) return false;
    const btn = pad.buttons?.[descriptor.index];
    if (!btn) return false;
    return btn.pressed || btn.value > 0.5;
  }, []);

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
      registerInputState(SOURCE, { connected: false, mappingReady });
      return;
    }

    if (!mappingReady) {
      registerInputState(SOURCE, { connected: true, mappingReady: false });
      return;
    }

    const axisLX = clampUnit(applyDeadzone(getAxisValue(pad, mapping.drive.horizontal), driveDeadzone));
    const axisLY = clampUnit(applyDeadzone(-getAxisValue(pad, mapping.drive.vertical), driveDeadzone));
    const vector = { x: axisLX, y: axisLY, boost: false };
    if (!vectorsEqual(vector, lastVectorRef.current)) {
      lastVectorRef.current = vector;
      setDriveVector(vector, { source: SOURCE });
    }

    const mainMagnitude = Math.round(getButtonValue(pad, mapping.triggers.main) * 127);
    const mainReverse = isButtonPressed(pad, mapping.buttons.mainReverse);
    const main = mainReverse ? -mainMagnitude : mainMagnitude;

    const sideMagnitude = Math.round(getButtonValue(pad, mapping.triggers.side) * 127);
    const sideReverse = isButtonPressed(pad, mapping.buttons.sideReverse);
    const side = sideReverse ? -Math.round(sideMagnitude * auxReverseScale) : sideMagnitude;

    const vacuum = isButtonPressed(pad, mapping.buttons.vacuum) ? 127 : 0;
    let aux = { main, side, vacuum };
    if (isButtonPressed(pad, mapping.buttons.allAux)) {
      aux = { main: 127, side: 127, vacuum: 127 };
    }
    if (!auxEqual(aux, lastAuxRef.current)) {
      lastAuxRef.current = aux;
      setAuxMotors(aux);
    }

    const cameraAxis = clampUnit(applyDeadzone(-getAxisValue(pad, mapping.camera.vertical), cameraDeadzone));
    const now = performance.now();
    if (Math.abs(cameraAxis) > 0.25 && now - servoThrottleRef.current > 120) {
      servoThrottleRef.current = now;
      nudgeServo(cameraAxis > 0 ? servoStep : -servoStep);
    }

    const driveMacroPressed = isButtonPressed(pad, mapping.buttons.driveMacro);
    if (handleButtonEdge(`macro-${mapping.buttons.driveMacro.index}`, driveMacroPressed)) {
      setMode('drive');
      runMacro('drive-sequence');
    }
    const dockMacroPressed = isButtonPressed(pad, mapping.buttons.dockMacro);
    if (handleButtonEdge(`macro-${mapping.buttons.dockMacro.index}`, dockMacroPressed)) {
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
    getAxisValue,
    getButtonValue,
    handleButtonEdge,
    isButtonPressed,
    mapping.buttons?.allAux,
    mapping.buttons?.dockMacro,
    mapping.buttons?.driveMacro,
    mapping.buttons?.mainReverse,
    mapping.buttons?.sideReverse,
    mapping.buttons?.vacuum,
    mapping.camera?.vertical,
    mapping.drive?.horizontal,
    mapping.drive?.vertical,
    mapping.triggers?.main,
    mapping.triggers?.side,
    mappingReady,
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
