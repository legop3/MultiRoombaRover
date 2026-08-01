// Gamepad Input Manager
// Purpose: Converts polled gamepad state into normalized control actions/commands. Scope: Integrates bindings, deadzone math, and dispatch callbacks for driving.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useControlActions, useControlSelector } from '../ControlContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { GAMEPAD_SETTINGS_DEFAULTS, GAMEPAD_PROFILE_DEFAULT } from '../../settings/namespaces.js';
import {
  computeGamepadOutputs,
  createProfileForPad,
  getPadSignature,
} from './gamepadBindings.js';
import { subscribeGamepadHub } from './gamepadHub.js';
import { isTextEntryActive } from './inputFocusUtils.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';

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
    setMode,
    setDriveVector,
    setAuxMotors,
    setServoAngle,
    setCameraAxisIntent,
    runMacro,
    toggleHeadlight,
    toggleLaser,
    registerInputState,
  } = useControlActions();
  const cameraAngle = useControlSelector((control) => control.state.camera?.angle);
  const cameraConfig = useControlSelector((control) => control.state.camera?.config);
  const roverId = useControlSelector((control) => control.state.roverId);
  const dockAssist = useManualDockAssist();
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
  // The hub subscription is intentionally stable, so this ref is the bridge back to the latest
  // React values. Rewriting it after each commit is cheaper than tearing down browser gamepad
  // listeners every time settings, camera state, or control callbacks change.
  const latestRef = useRef(null);

  const ensureProfile = useCallback((padState) => {
    const latest = latestRef.current;
    if (!latest) return;
    const signature = padState.signature ?? getPadSignature(padState);
    if (latest.gamepadSettings?.profiles?.[signature] || profileCacheRef.current.has(signature)) {
      return;
    }
    profileCacheRef.current.add(signature);
    latest.saveGamepadSettings((prev) => {
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
  }, []);

  const handleButtonEdge = useCallback((key, pressed) => {
    const prev = buttonStateRef.current.get(key) || false;
    buttonStateRef.current.set(key, pressed);
    return pressed && !prev;
  }, []);

  const handleCameraAxis = useCallback((axisValue, calibration) => {
    const latest = latestRef.current;
    const config = latest?.cameraConfig;
    if (!latest || !config) return;
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
          : typeof latest.cameraAngle === 'number'
          ? latest.cameraAngle
          : typeof config.homeAngle === 'number'
          ? config.homeAngle
          : 0;
      const nextAngle = baseline + delta;
      latest.setServoAngle(nextAngle);
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
    latest.setServoAngle(angle);
  }, []);

  const activeSignature = useMemo(
    () => gamepadSettings?.activeSignature ?? null,
    [gamepadSettings?.activeSignature],
  );

  useLayoutEffect(() => {
    // Layout timing matters because the requestAnimationFrame gamepad poll can run immediately
    // after React commits. Updating this ref before paint keeps the stable hub callback aligned
    // with the newest settings and control actions without resubscribing to the hub.
    latestRef.current = {
      activeSignature,
      cameraAngle,
      cameraConfig,
      dockAssist,
      gamepadSettings,
      registerInputState,
      roverId,
      runMacro,
      saveGamepadSettings,
      setAuxMotors,
      setCameraAxisIntent,
      setDriveVector,
      setMode,
      setServoAngle,
      toggleHeadlight,
      toggleLaser,
    };
  });

  useEffect(() => {
    return subscribeGamepadHub((hubState) => {
      const latest = latestRef.current;
      if (!latest) return;
      const activePad = pickActivePad(hubState.pads, latest.activeSignature);
      if (!activePad) {
        // A disconnected controller cannot deliver a final neutral axis sample.
        // Publish it here so PTZ zoom never depends on the browser doing so.
        latest.setCameraAxisIntent(0);
        if (!areVectorsEqual(lastVectorRef.current, ZERO_VECTOR)) {
          lastVectorRef.current = ZERO_VECTOR;
          latest.setDriveVector(ZERO_VECTOR, { source: SOURCE });
        }
        if (!areAuxEqual(lastAuxRef.current, ZERO_AUX)) {
          lastAuxRef.current = ZERO_AUX;
          latest.setAuxMotors(ZERO_AUX);
        }
        buttonStateRef.current = new Map();
        reverseStateRef.current = { main: false, side: false };
        lastDriveSentAtRef.current = 0;
        lastAuxSentAtRef.current = 0;
        latest.registerInputState(SOURCE, { connected: false });
        return;
      }

      if (isTextEntryActive()) {
        // Entering text blocks gamepad control immediately, including a held
        // camera axis that otherwise would keep its last PTZ zoom direction.
        latest.setCameraAxisIntent(0);
        if (!areVectorsEqual(lastVectorRef.current, ZERO_VECTOR)) {
          lastVectorRef.current = ZERO_VECTOR;
          latest.setDriveVector(ZERO_VECTOR, { source: SOURCE });
        }
        if (!areAuxEqual(lastAuxRef.current, ZERO_AUX)) {
          lastAuxRef.current = ZERO_AUX;
          latest.setAuxMotors(ZERO_AUX);
        }
        buttonStateRef.current = new Map();
        reverseStateRef.current = { main: false, side: false };
        latest.registerInputState(SOURCE, { connected: true, blocked: true });
        return;
      }

      ensureProfile(activePad);
      const signature = activePad.signature;
      const profile =
        latest.gamepadSettings?.profiles?.[signature] ??
        latest.gamepadSettings?.defaults?.profile ??
        GAMEPAD_PROFILE_DEFAULT;
      const outputs = computeGamepadOutputs(activePad, profile);

      if (!areVectorsEqual(outputs.driveVector, lastVectorRef.current)) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const idle = vectorMagnitude(outputs.driveVector) < 0.02;
        if (idle || now - lastDriveSentAtRef.current >= DRIVE_RATE_MS) {
          lastVectorRef.current = outputs.driveVector;
          lastDriveSentAtRef.current = now;
          latest.setDriveVector(outputs.driveVector, { source: SOURCE });
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
          latest.setAuxMotors(aux);
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
        latest.dockAssist.exitAssist();
        latest.setMode('drive');
        latest.runMacro('drive-sequence');
      } else if (!outputs.buttons.driveMacro) {
        handleButtonEdge('driveMacro', false);
      }

      if (outputs.buttons.dockMacro && handleButtonEdge('dockMacro', true)) {
        latest.dockAssist.toggleAssist();
      } else if (!outputs.buttons.dockMacro) {
        handleButtonEdge('dockMacro', false);
      }

      if (outputs.buttons.headlightToggle && handleButtonEdge('headlightToggle', true)) {
        latest.toggleHeadlight();
      } else if (!outputs.buttons.headlightToggle) {
        handleButtonEdge('headlightToggle', false);
      }

      if (outputs.buttons.laserToggle && handleButtonEdge('laserToggle', true)) {
        latest.toggleLaser();
      } else if (!outputs.buttons.laserToggle) {
        handleButtonEdge('laserToggle', false);
      }

      /*
        PTZ zoom consumes the live signed gamepad axis, including its zero
        position, so releasing the stick is an explicit stop instead of merely
        ending calls to the old servo updater. Rover camera servos return false
        here and continue through their established absolute/velocity mapping.
      */
      const handledAsPtzZoom = latest.setCameraAxisIntent(outputs.cameraAxis);
      if (!handledAsPtzZoom && Math.abs(outputs.cameraAxis) > 0.001) {
        handleCameraAxis(outputs.cameraAxis, profile.calibration);
      }

      latest.registerInputState(SOURCE, {
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
  }, [ensureProfile, handleButtonEdge, handleCameraAxis]);

  return null;
}
