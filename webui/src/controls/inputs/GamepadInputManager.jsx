import { useCallback, useEffect, useRef } from 'react';
import { useControlSystem } from '../ControlContext.jsx';
import { clampUnit } from '../controlMath.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS, GAMEPAD_MAPPING_DEFAULT } from '../../settings/namespaces.js';

const SOURCE = 'gamepad';

function applyDeadzone(value, amount) {
  return Math.abs(value) < amount ? 0 : value;
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
  const driveReady = Boolean(mapping?.drive?.horizontal && mapping?.drive?.vertical);
  const cameraReady = Boolean(mapping?.camera?.vertical);
  const mainAxisReady = Boolean(mapping?.brushes?.mainAxis);
  const sideAxisReady = Boolean(mapping?.brushes?.sideAxis);
  const brushesReady = mainAxisReady || sideAxisReady;
  const vacuumReady = Boolean(mapping?.buttons?.vacuum);
  const allAuxReady = Boolean(mapping?.buttons?.allAux);
  const auxButtonsReady = vacuumReady || allAuxReady;
  const mainReverseReady = Boolean(mapping?.buttons?.mainReverse);
  const sideReverseReady = Boolean(mapping?.buttons?.sideReverse);
  const reverseButtonsReady = mainReverseReady || sideReverseReady;
  const driveMacroReady = Boolean(mapping?.buttons?.drive);
  const dockMacroReady = Boolean(mapping?.buttons?.dock);
  const macrosReady = driveMacroReady || dockMacroReady;
  const mappingReady =
    driveReady || cameraReady || brushesReady || auxButtonsReady || reverseButtonsReady || macrosReady;
  const rafRef = useRef(null);
  const lastVectorRef = useRef({ x: 0, y: 0, boost: false });
  const lastAuxRef = useRef({ main: 0, side: 0, vacuum: 0 });
  const buttonStateRef = useRef(new Map());
  const servoThrottleRef = useRef(0);
  const reverseStateRef = useRef({ main: false, side: false });

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

    const axisLX = driveReady
      ? clampUnit(applyDeadzone(getAxisValue(pad, mapping.drive.horizontal), driveDeadzone))
      : 0;
    const axisLY = driveReady
      ? clampUnit(applyDeadzone(-getAxisValue(pad, mapping.drive.vertical), driveDeadzone))
      : 0;
    const vector = { x: axisLX, y: axisLY, boost: false };
    if (!vectorsEqual(vector, lastVectorRef.current)) {
      lastVectorRef.current = vector;
      setDriveVector(vector, { source: SOURCE });
    }

    const mainRaw = mainAxisReady ? getAxisValue(pad, mapping.brushes.mainAxis) : 0;
    const mainMagnitude = Math.round(Math.min(Math.abs(mainRaw), 1) * 127);
    const main = reverseStateRef.current.main ? -mainMagnitude : mainMagnitude;

    const sideRaw = sideAxisReady ? getAxisValue(pad, mapping.brushes.sideAxis) : 0;
    const sideMagnitude = Math.round(Math.min(Math.abs(sideRaw), 1) * 127);
    const side = reverseStateRef.current.side
      ? -Math.round(sideMagnitude * auxReverseScale)
      : Math.round(sideMagnitude * auxReverseScale);

    const vacuum = vacuumReady && isButtonPressed(pad, mapping.buttons.vacuum) ? 127 : 0;
    let aux = { main: mainAxisReady ? main : 0, side: sideAxisReady ? side : 0, vacuum };
    if (allAuxReady && isButtonPressed(pad, mapping.buttons.allAux)) {
      aux = { main: 127, side: 127, vacuum: 127 };
    }
    if (!auxEqual(aux, lastAuxRef.current)) {
      lastAuxRef.current = aux;
      setAuxMotors(aux);
    }

    const cameraAxis = cameraReady
      ? clampUnit(applyDeadzone(-getAxisValue(pad, mapping.camera.vertical), cameraDeadzone))
      : 0;
    const now = performance.now();
    if (cameraReady && Math.abs(cameraAxis) > 0.25 && now - servoThrottleRef.current > 120) {
      servoThrottleRef.current = now;
      nudgeServo(cameraAxis > 0 ? servoStep : -servoStep);
    }

    if (
      mainReverseReady &&
      handleButtonEdge('toggle-main', isButtonPressed(pad, mapping.buttons.mainReverse))
    ) {
      reverseStateRef.current.main = !reverseStateRef.current.main;
    }
    if (
      sideReverseReady &&
      handleButtonEdge('toggle-side', isButtonPressed(pad, mapping.buttons.sideReverse))
    ) {
      reverseStateRef.current.side = !reverseStateRef.current.side;
    }

    if (
      driveMacroReady &&
      handleButtonEdge(`macro-${mapping.buttons.drive.index}`, isButtonPressed(pad, mapping.buttons.drive))
    ) {
      setMode('drive');
      runMacro('drive-sequence');
    }
    if (
      dockMacroReady &&
      handleButtonEdge(`macro-${mapping.buttons.dock.index}`, isButtonPressed(pad, mapping.buttons.dock))
    ) {
      setMode('dock');
      runMacro('seek-dock');
    }

    registerInputState(SOURCE, {
      connected: true,
      mappingReady,
      id: pad.id,
      index: pad.index,
      axes: [axisLX, axisLY, cameraAxis],
      reverse: { ...reverseStateRef.current },
      bindings: {
        drive: driveReady,
        camera: cameraReady,
        brushes: brushesReady,
        auxButtons: { vacuum: vacuumReady, allAux: allAuxReady },
        reverseButtons: { main: mainReverseReady, side: sideReverseReady },
        macros: { drive: driveMacroReady, dock: dockMacroReady },
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
    mapping.buttons?.dock,
    mapping.buttons?.drive,
    mapping.buttons?.mainReverse,
    mapping.buttons?.sideReverse,
    mapping.buttons?.vacuum,
    mapping.camera?.vertical,
    mapping.drive?.horizontal,
    mapping.drive?.vertical,
    mapping.brushes?.mainAxis,
    mapping.brushes?.sideAxis,
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
