// Gamepad Input Manager
// Purpose: Converts polled gamepad state into normalized control actions/commands. Scope: Integrates bindings, deadzone math, and dispatch callbacks for driving.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useControlSystem } from '../ControlContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { GAMEPAD_SETTINGS_DEFAULTS, GAMEPAD_PROFILE_DEFAULT } from '../../settings/namespaces.js';
import {
  computeGamepadOutputs,
  createProfileForPad,
  getPadSignature,
} from './gamepadBindings.js';
import { subscribeGamepadHub } from './gamepadHub.js';
import { isTextEntryActive } from './inputFocusUtils.js';

const SOURCE = 'gamepad';
const ZERO_VECTOR = { x: 0, y: 0, boost: false };
const ZERO_AUX = { main: 0, side: 0, vacuum: 0 };
const DRIVE_RATE_MS = 100;
const AUX_RATE_MS = 100;

function areVectorsEqual(a, b) {
  return a && b && a.x === b.x && a.y === b.y && a.boost === b.boost;
}

function areAuxEqual(a, b) {
  return a && b && a.main === b.main && a.side === b.side && a.vacuum === b.vacuum;
}

function vectorMagnitude(vector) {
  if (!vector) return 0;
  return Math.hypot(vector.x || 0, vector.y || 0);
}

function isAuxIdle(aux) {
  if (!aux) return true;
  return !aux.main && !aux.side && !aux.vacuum;
}

function pickActivePad(pads, activeSignature) {
  if (!pads || pads.length === 0) return null;
  if (activeSignature) {
    const match = pads.find((pad) => pad.signature === activeSignature);
    if (match) return match;
  }
  return pads[0];
}

export default function GamepadInputManager() {
  const {
    state,
    actions: {
      setMode,
      setManualDockAssistActive,
      toggleManualDockAssist,
      setDriveVector,
      setAuxMotors,
      setServoAngle,
      runMacro,
      toggleNightVision,
      registerInputState,
    },
  } = useControlSystem();
  const { value: gamepadSettings, save: saveGamepadSettings } = useSettingsNamespace(
    'gamepad',
    GAMEPAD_SETTINGS_DEFAULTS,
  );
  const profileCacheRef = useRef(new Set());
  const lastVectorRef = useRef(ZERO_VECTOR);
  const lastAuxRef = useRef(ZERO_AUX);
  const reverseStateRef = useRef({ main: false, side: false });
  const buttonStateRef = useRef(new Map());
  const lastDriveSentAtRef = useRef(0);
  const lastAuxSentAtRef = useRef(0);
  const lastServoAtRef = useRef(0);
  const lastServoAngleRef = useRef(null);

  const ensureProfile = useCallback(
    (padState) => {
      const signature = padState.signature ?? getPadSignature(padState);
      if (gamepadSettings?.profiles?.[signature] || profileCacheRef.current.has(signature)) {
        return;
      }
      profileCacheRef.current.add(signature);
      saveGamepadSettings((prev) => {
        const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
        if (current.profiles?.[signature]) return current;
        const base = current?.defaults?.profile ?? GAMEPAD_PROFILE_DEFAULT;
        const nextProfile = createProfileForPad(padState, base);
        return {
          ...current,
          profiles: {
            ...(current.profiles ?? {}),
            [signature]: nextProfile,
          },
        };
      });
    },
    [gamepadSettings?.profiles, saveGamepadSettings],
  );

  const handleButtonEdge = useCallback((key, pressed) => {
    const prev = buttonStateRef.current.get(key) || false;
    buttonStateRef.current.set(key, pressed);
    return pressed && !prev;
  }, []);

  const handleCameraAxis = useCallback(
    (axisValue, calibration) => {
      const config = state.camera?.config;
      if (!config) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const cameraMode = calibration?.cameraMode ?? 'absolute';
      const sensitivity = Math.max(1, Math.min(180, calibration?.cameraSensitivity ?? 60));
      if (cameraMode === 'velocity') {
        const dt = Math.min(50, now - lastServoAtRef.current || 16);
        const delta = axisValue * sensitivity * (dt / 1000);
        if (Math.abs(delta) < 0.01) return;
        const baseline =
          typeof lastServoAngleRef.current === 'number'
            ? lastServoAngleRef.current
            : typeof state.camera?.angle === 'number'
            ? state.camera.angle
            : typeof config.homeAngle === 'number'
            ? config.homeAngle
            : 0;
        const nextAngle = baseline + delta;
        setServoAngle(nextAngle);
        lastServoAngleRef.current = nextAngle;
        lastServoAtRef.current = now;
        return;
      }
      const min = typeof config.minAngle === 'number' ? config.minAngle : -45;
      const max = typeof config.maxAngle === 'number' ? config.maxAngle : 45;
      const home = typeof config.homeAngle === 'number' ? config.homeAngle : (min + max) / 2;
      const angle =
        axisValue < 0
          ? home + axisValue * (home - min)
          : home + axisValue * (max - home);
      if (
        typeof lastServoAngleRef.current === 'number' &&
        Math.abs(lastServoAngleRef.current - angle) < 0.35 &&
        now - lastServoAtRef.current < 80
      ) {
        return;
      }
      lastServoAtRef.current = now;
      lastServoAngleRef.current = angle;
      setServoAngle(angle);
    },
    [setServoAngle, state.camera?.angle, state.camera?.config],
  );

  const activeSignature = useMemo(
    () => gamepadSettings?.activeSignature ?? null,
    [gamepadSettings?.activeSignature],
  );

  useEffect(() => {
    return subscribeGamepadHub((hubState) => {
      const activePad = pickActivePad(hubState.pads, activeSignature);
      if (!activePad) {
        if (!areVectorsEqual(lastVectorRef.current, ZERO_VECTOR)) {
          lastVectorRef.current = ZERO_VECTOR;
          setDriveVector(ZERO_VECTOR, { source: SOURCE });
        }
        if (!areAuxEqual(lastAuxRef.current, ZERO_AUX)) {
          lastAuxRef.current = ZERO_AUX;
          setAuxMotors(ZERO_AUX);
        }
        buttonStateRef.current = new Map();
        reverseStateRef.current = { main: false, side: false };
        lastDriveSentAtRef.current = 0;
        lastAuxSentAtRef.current = 0;
        registerInputState(SOURCE, { connected: false });
        return;
      }

      if (isTextEntryActive()) {
        if (!areVectorsEqual(lastVectorRef.current, ZERO_VECTOR)) {
          lastVectorRef.current = ZERO_VECTOR;
          setDriveVector(ZERO_VECTOR, { source: SOURCE });
        }
        if (!areAuxEqual(lastAuxRef.current, ZERO_AUX)) {
          lastAuxRef.current = ZERO_AUX;
          setAuxMotors(ZERO_AUX);
        }
        buttonStateRef.current = new Map();
        reverseStateRef.current = { main: false, side: false };
        registerInputState(SOURCE, { connected: true, blocked: true });
        return;
      }

      ensureProfile(activePad);
      const signature = activePad.signature;
      const profile =
        gamepadSettings?.profiles?.[signature] ??
        gamepadSettings?.defaults?.profile ??
        GAMEPAD_PROFILE_DEFAULT;
      const outputs = computeGamepadOutputs(activePad, profile);

      if (!areVectorsEqual(outputs.driveVector, lastVectorRef.current)) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const idle = vectorMagnitude(outputs.driveVector) < 0.02;
        if (idle || now - lastDriveSentAtRef.current >= DRIVE_RATE_MS) {
          lastVectorRef.current = outputs.driveVector;
          lastDriveSentAtRef.current = now;
          setDriveVector(outputs.driveVector, { source: SOURCE });
        }
      }

      const auxSideScale = profile.calibration?.auxSideScale ?? 0.55;
      const mainMagnitude = Math.round(Math.min(Math.abs(outputs.auxAxis.main), 1) * 127);
      const sideMagnitude = Math.round(Math.min(Math.abs(outputs.auxAxis.side), 1) * 127);
      const main = reverseStateRef.current.main ? -mainMagnitude : mainMagnitude;
      const side = reverseStateRef.current.side
        ? -Math.round(sideMagnitude * auxSideScale)
        : Math.round(sideMagnitude * auxSideScale);
      let aux = {
        main: outputs.auxAxis.main !== 0 ? main : 0,
        side: outputs.auxAxis.side !== 0 ? side : 0,
        vacuum: outputs.buttons.vacuum ? 127 : 0,
      };
      if (outputs.buttons.allAux) {
        aux = { main: 127, side: 127, vacuum: 127 };
      }
      if (!areAuxEqual(aux, lastAuxRef.current)) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (isAuxIdle(aux) || now - lastAuxSentAtRef.current >= AUX_RATE_MS) {
          lastAuxRef.current = aux;
          lastAuxSentAtRef.current = now;
          setAuxMotors(aux);
        }
      }

      if (outputs.buttons.mainReverse && handleButtonEdge('mainReverse', true)) {
        reverseStateRef.current.main = !reverseStateRef.current.main;
      } else if (!outputs.buttons.mainReverse) {
        handleButtonEdge('mainReverse', false);
      }

      if (outputs.buttons.sideReverse && handleButtonEdge('sideReverse', true)) {
        reverseStateRef.current.side = !reverseStateRef.current.side;
      } else if (!outputs.buttons.sideReverse) {
        handleButtonEdge('sideReverse', false);
      }

      if (outputs.buttons.driveMacro && handleButtonEdge('driveMacro', true)) {
        setManualDockAssistActive(false);
        setMode('drive');
        runMacro('drive-sequence');
      } else if (!outputs.buttons.driveMacro) {
        handleButtonEdge('driveMacro', false);
      }

      if (outputs.buttons.dockMacro && handleButtonEdge('dockMacro', true)) {
        toggleManualDockAssist();
      } else if (!outputs.buttons.dockMacro) {
        handleButtonEdge('dockMacro', false);
      }

      if (outputs.buttons.nightVisionToggle && handleButtonEdge('nightVisionToggle', true)) {
        toggleNightVision();
      } else if (!outputs.buttons.nightVisionToggle) {
        handleButtonEdge('nightVisionToggle', false);
      }

      if (Math.abs(outputs.cameraAxis) > 0.001) {
        handleCameraAxis(outputs.cameraAxis, profile.calibration);
      }

      registerInputState(SOURCE, {
        connected: true,
        signature,
        id: activePad.id,
        index: activePad.index,
        axes: activePad.axes,
        buttons: activePad.buttons,
        drive: outputs.driveVector,
        aux,
        cameraAxis: outputs.cameraAxis,
        bindings: outputs.sources,
      });
    });
  }, [
    activeSignature,
    ensureProfile,
    gamepadSettings?.defaults?.profile,
    gamepadSettings?.profiles,
    handleButtonEdge,
    handleCameraAxis,
    registerInputState,
    runMacro,
    setManualDockAssistActive,
    setAuxMotors,
    setDriveVector,
    setMode,
    toggleManualDockAssist,
    toggleNightVision,
  ]);

  return null;
}
