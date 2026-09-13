// Gamepad Input Manager
// Purpose: Converts polled gamepad state into normalized control actions/commands. Scope: Integrates bindings, deadzone math, and dispatch callbacks for driving.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useControlActions, useControlSelector } from '../ControlContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import {
  GAMEPAD_SETTINGS_DEFAULTS,
  GAMEPAD_PROFILE_DEFAULT,
  VIDEO_SETTINGS_DEFAULTS,
} from '../../settings/namespaces.js';
import {
  advanceCameraAngle,
  computeGamepadOutputs,
  createProfileForPad,
  getPadSignature,
  resolveGamepadProfile,
} from './gamepadBindings.js';
import { subscribeGamepadHub } from './gamepadHub.js';
import { isTextEntryActive } from './inputFocusUtils.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';
import {
  isControllerControlLocked,
  markControllerDisconnected,
  markControllerInputActive,
} from './controllerRuntime.js';
import { useChatActions, useChatFocus } from '../../context/ChatContext.jsx';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { SONG_DEFAULT_DURATION, SONG_DEFAULT_NOTE, SONG_NOTE_RANGE } from '../constants.js';

const SOURCE = 'gamepad';
const ZERO_VECTOR = { x: 0, y: 0, boost: false };
const ZERO_AUX = { main: 0, side: 0, vacuum: 0 };
const DRIVE_RATE_MS = 100;
const AUX_RATE_MS = 100;
const CONTROLLER_ACTIVITY_AXIS_MIN = 0.24;
const CONTROLLER_ACTIVITY_AXIS_DELTA = 0.08;
const VIDEO_FILTER_SEQUENCE = ['none', 'grayscale', 'greenscale'];

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

function pickActivePad(pads, activeInstanceKey) {
  if (!pads || pads.length === 0) return null;
  if (activeInstanceKey) {
    const match = pads.find((pad) => pad.instanceKey === activeInstanceKey);
    if (match) return match;
  }
  return pads[0];
}

function hasMeaningfulControllerChange(pad, previous) {
  if (!previous) {
    return pad.buttons.some((button) => button.pressed) ||
      pad.axes.some((axis) => Math.abs(axis) >= CONTROLLER_ACTIVITY_AXIS_MIN);
  }
  const buttonPressed = pad.buttons.some(
    (button, index) => button.pressed && !previous.buttons?.[index]?.pressed,
  );
  if (buttonPressed) return true;
  return pad.axes.some((axis, index) => {
    const oldAxis = previous.axes?.[index] ?? 0;
    return Math.abs(axis) >= CONTROLLER_ACTIVITY_AXIS_MIN &&
      Math.abs(axis - oldAxis) >= CONTROLLER_ACTIVITY_AXIS_DELTA;
  });
}

function isControllerNeutral(pad) {
  return !pad.buttons.some((button) => button.pressed || button.value > 0.1) &&
    !pad.axes.some((axis) => Math.abs(axis) > 0.2);
}

function nextVideoFilter(value) {
  const index = VIDEO_FILTER_SEQUENCE.indexOf(value);
  return VIDEO_FILTER_SEQUENCE[(index < 0 ? 0 : index + 1) % VIDEO_FILTER_SEQUENCE.length];
}

function cycleHomeAssistant(latest, targetState) {
  const homeAssistant = latest.homeAssistant;
  if (!homeAssistant?.enabled || !homeAssistant?.connected) return;
  if (
    (homeAssistant.lightPolicy?.locked || homeAssistant.lightPolicy?.lockedOn) &&
    !latest.adminCanControlLockedLights
  ) {
    return;
  }
  const entities = (homeAssistant.entities ?? []).filter(
    (entity) =>
      (entity.type === 'light' || entity.type === 'switch') &&
      entity.available !== false &&
      entity.state !== 'unavailable',
  );
  const ordered = targetState === 'on' ? entities : [...entities].reverse();
  const next = ordered.find((entity) =>
    targetState === 'on' ? entity.state !== 'on' : entity.state === 'on',
  );
  if (next) latest.homeAssistantSetState(next.id, targetState).catch(() => {});
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
    sendSong,
    setSongNote,
    startHorn,
    stopHorn,
    setMicPttActive,
  } = useControlActions();
  const cameraAngle = useControlSelector((control) => control.state.camera?.angle);
  const cameraConfig = useControlSelector((control) => control.state.camera?.config);
  const roverId = useControlSelector((control) => control.state.roverId);
  const dockAssist = useManualDockAssist();
  const { focusChat } = useChatActions();
  const { isChatFocused } = useChatFocus();
  const { homeAssistantSetState, pushAlert } = useSessionActions();
  const homeAssistant = useSessionSelector((state) => state.session?.homeAssistant || null);
  const role = useSessionSelector((state) => state.session?.role || null);
  const sessionMode = useSessionSelector((state) => state.session?.mode || null);
  const songNote = useControlSelector((control) => control.state.song?.note);
  const { value: videoSettings, save: saveVideoSettings } = useSettingsNamespace(
    'video',
    VIDEO_SETTINGS_DEFAULTS,
  );
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
  const previousPadRef = useRef(null);
  const lastConnectedSignatureRef = useRef(null);
  const lastConnectedInstanceKeyRef = useRef(null);
  const lastRegisteredSignatureRef = useRef(null);
  const controllerLockedRef = useRef(false);
  const waitingForNeutralRef = useRef(false);
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
      const base = resolveGamepadProfile(
        current?.defaults?.profile,
        GAMEPAD_PROFILE_DEFAULT,
      );
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
    const cameraMode = calibration?.cameraMode ?? 'velocity';
    const sensitivity = calibration?.cameraSensitivity ?? 60;
    const min = typeof config.minAngle === 'number' ? config.minAngle : -45;
    const max = typeof config.maxAngle === 'number' ? config.maxAngle : 45;
    if (cameraMode === 'velocity') {
      if (Math.abs(axisValue) <= 0.001) {
        /* Neutral is the safe synchronization point: no controller motion is being integrated, so
           an angle changed by another UI can replace our accumulator without causing jitter. */
        if (typeof latest.cameraAngle === 'number') lastServoAngleRef.current = latest.cameraAngle;
        lastServoAtRef.current = now;
        return;
      }
      const dt = Math.min(50, now - lastServoAtRef.current || 16);
      const baseline =
        typeof lastServoAngleRef.current === 'number'
          ? lastServoAngleRef.current
          : typeof latest.cameraAngle === 'number'
          ? latest.cameraAngle
          : typeof config.homeAngle === 'number'
          ? config.homeAngle
          : 0;
      const nextAngle = advanceCameraAngle(baseline, axisValue, sensitivity, dt, { min, max });
      latest.setServoAngle(nextAngle);
      lastServoAngleRef.current = nextAngle;
      lastServoAtRef.current = now;
      return;
    }
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

  const neutralizeController = useCallback((latest) => {
    /*
      Every path that makes controller commands unsafe converges here. In particular, held horn
      and microphone actions need releases just as much as drive and motor axes need zeroes.
    */
    latest.setCameraAxisIntent(0);
    if (!areVectorsEqual(lastVectorRef.current, ZERO_VECTOR)) {
      lastVectorRef.current = ZERO_VECTOR;
      latest.setDriveVector(ZERO_VECTOR, { source: SOURCE });
    }
    if (!areAuxEqual(lastAuxRef.current, ZERO_AUX)) {
      lastAuxRef.current = ZERO_AUX;
      latest.setAuxMotors(ZERO_AUX);
    }
    if (buttonStateRef.current.get('hornHonk')) latest.stopHorn();
    if (buttonStateRef.current.get('micPtt')) latest.setMicPttActive(false);
    buttonStateRef.current = new Map();
    reverseStateRef.current = { main: false, side: false };
  }, []);

  const activeInstanceKey = useMemo(
    () => gamepadSettings?.activeInstanceKey ?? null,
    [gamepadSettings?.activeInstanceKey],
  );

  useLayoutEffect(() => {
    // Layout timing matters because the requestAnimationFrame gamepad poll can run immediately
    // after React commits. Updating this ref before paint keeps the stable hub callback aligned
    // with the newest settings and control actions without resubscribing to the hub.
    latestRef.current = {
      activeInstanceKey,
      adminCanControlLockedLights:
        role === 'lockdown' || (role === 'admin' && sessionMode !== 'lockdown'),
      cameraAngle,
      cameraConfig,
      dockAssist,
      focusChat,
      gamepadSettings,
      homeAssistant,
      homeAssistantSetState,
      isChatFocused,
      pushAlert,
      registerInputState,
      roverId,
      runMacro,
      saveGamepadSettings,
      saveVideoSettings,
      sendSong,
      setAuxMotors,
      setCameraAxisIntent,
      setDriveVector,
      setMicPttActive,
      setMode,
      setSongNote,
      setServoAngle,
      songNote,
      startHorn,
      stopHorn,
      toggleHeadlight,
      toggleLaser,
      videoColorFilter: videoSettings?.colorFilter ?? VIDEO_SETTINGS_DEFAULTS.colorFilter,
    };
  });

  useEffect(() => {
    const unsubscribe = subscribeGamepadHub((hubState) => {
      const latest = latestRef.current;
      if (!latest) return;
      const activePad = pickActivePad(hubState.pads, latest.activeInstanceKey);
      if (!activePad) {
        // A disconnect cannot provide release samples, so synthesize every required release once.
        neutralizeController(latest);
        markControllerDisconnected(lastConnectedSignatureRef.current);
        previousPadRef.current = null;
        lastConnectedSignatureRef.current = null;
        lastConnectedInstanceKeyRef.current = null;
        lastRegisteredSignatureRef.current = null;
        controllerLockedRef.current = false;
        waitingForNeutralRef.current = false;
        lastDriveSentAtRef.current = 0;
        lastAuxSentAtRef.current = 0;
        latest.registerInputState(SOURCE, { connected: false });
        return;
      }

      if (
        lastConnectedInstanceKeyRef.current &&
        lastConnectedInstanceKeyRef.current !== activePad.instanceKey
      ) {
        /* Browser slots distinguish two identical controllers. Neutralize the old owner before
           accepting the replacement and require any controls already held on the new pad to be
           released, preventing a selection change from inheriting drive, horn, or microphone. */
        neutralizeController(latest);
        previousPadRef.current = null;
        lastRegisteredSignatureRef.current = null;
        waitingForNeutralRef.current = true;
      }

      if (hasMeaningfulControllerChange(activePad, previousPadRef.current)) {
        markControllerInputActive(activePad);
      }
      previousPadRef.current = activePad;
      lastConnectedSignatureRef.current = activePad.signature;
      lastConnectedInstanceKeyRef.current = activePad.instanceKey;

      const controlsBlocked = isTextEntryActive() || isControllerControlLocked();
      if (controlsBlocked) {
        /* Configuration and text entry still receive hub snapshots, but they must never leak
           through to physical rover actions. Only publish/reset on the transition into the lock. */
        if (!controllerLockedRef.current) {
          neutralizeController(latest);
          latest.registerInputState(SOURCE, { connected: true, blocked: true });
        }
        controllerLockedRef.current = true;
        waitingForNeutralRef.current = true;
        return;
      }
      if (controllerLockedRef.current) {
        controllerLockedRef.current = false;
        latest.registerInputState(SOURCE, { connected: true, blocked: false });
      }
      /* A control held while a dialog closes must not become a fresh command. Require a neutral
         sample before rearming the controller, just like releasing an emergency-stop switch. */
      if (waitingForNeutralRef.current) {
        if (!isControllerNeutral(activePad)) return;
        waitingForNeutralRef.current = false;
      }

      ensureProfile(activePad);
      const signature = activePad.signature;
      const storedProfile =
        latest.gamepadSettings?.profiles?.[signature] ??
        latest.gamepadSettings?.defaults?.profile ??
        GAMEPAD_PROFILE_DEFAULT;
      const profile = resolveGamepadProfile(storedProfile, GAMEPAD_PROFILE_DEFAULT);
      const outputs = computeGamepadOutputs(activePad, profile);

      const driveVector = {
        ...outputs.driveVector,
        boost: Boolean(outputs.buttons.boostModifier),
      };
      if (!areVectorsEqual(driveVector, lastVectorRef.current)) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const idle = vectorMagnitude(driveVector) < 0.02;
        if (idle || now - lastDriveSentAtRef.current >= DRIVE_RATE_MS) {
          lastVectorRef.current = driveVector;
          lastDriveSentAtRef.current = now;
          const precisionSpeed = profile.calibration?.precisionSpeed ?? 100;
          const baseSpeed = profile.calibration?.baseSpeed ?? 500;
          const turboSpeed = profile.calibration?.turboSpeed ?? 500;
          latest.setDriveVector(driveVector, {
            source: SOURCE,
            speedOptions: outputs.buttons.slowModifier
              ? { baseSpeed: precisionSpeed, boostSpeed: precisionSpeed }
              : { baseSpeed, boostSpeed: turboSpeed },
          });
        }
      }

      const auxSideScale = profile.calibration?.auxSideScale ?? 0.55;
      const mainMagnitude = Math.round(Math.min(Math.abs(outputs.auxAxis.main), 1) * 127);
      const sideMagnitude = Math.round(Math.min(Math.abs(outputs.auxAxis.side), 1) * 127);
      const main = reverseStateRef.current.main ? -mainMagnitude : mainMagnitude;
      const side = reverseStateRef.current.side
        ? -Math.round(sideMagnitude * auxSideScale)
        : Math.round(sideMagnitude * auxSideScale);
      /* Digital bindings intentionally override proportional axes. This mirrors keyboard aux
         precedence exactly while preserving the controller-friendly analog defaults. */
      let aux = {
        main: outputs.buttons.auxMainForward
          ? 127
          : outputs.buttons.auxMainReverse
          ? -127
          : outputs.auxAxis.main !== 0
          ? main
          : 0,
        side: outputs.buttons.auxSideForward
          ? 127
          : outputs.buttons.auxSideReverse
          ? -70
          : outputs.auxAxis.side !== 0
          ? side
          : 0,
        vacuum: (outputs.buttons.vacuum || outputs.buttons.auxVacuumFast)
          ? 127
          : outputs.buttons.auxVacuumSlow
          ? 50
          : 0,
      };
      if (outputs.buttons.allAux || outputs.buttons.auxAllForward) {
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

      const hornWasPressed = buttonStateRef.current.get('hornHonk') || false;
      if (outputs.buttons.hornHonk && handleButtonEdge('hornHonk', true)) {
        latest.startHorn();
      } else if (!outputs.buttons.hornHonk) {
        handleButtonEdge('hornHonk', false);
        if (hornWasPressed) latest.stopHorn();
      }

      const micWasPressed = buttonStateRef.current.get('micPtt') || false;
      if (outputs.buttons.micPtt && handleButtonEdge('micPtt', true)) {
        latest.setMicPttActive(true);
      } else if (!outputs.buttons.micPtt) {
        handleButtonEdge('micPtt', false);
        if (micWasPressed) latest.setMicPttActive(false);
      }

      if (outputs.buttons.videoFilterCycle && handleButtonEdge('videoFilterCycle', true)) {
        const nextFilter = nextVideoFilter(latest.videoColorFilter);
        latest.saveVideoSettings((current) => ({ ...(current ?? {}), colorFilter: nextFilter }));
        latest.pushAlert({
          id: 'video-filter-active',
          title: 'Video filter',
          message: `Rover video filter: ${nextFilter}`,
          color: '#38bdf8',
          lifetimeMs: 1600,
        });
      } else if (!outputs.buttons.videoFilterCycle) {
        handleButtonEdge('videoFilterCycle', false);
      }

      if (outputs.buttons.chatFocus && handleButtonEdge('chatFocus', true)) {
        if (!latest.isChatFocused) latest.focusChat();
      } else if (!outputs.buttons.chatFocus) {
        handleButtonEdge('chatFocus', false);
      }

      /* Song directions share identical edge and wrap behavior; the table keeps the two actions
         symmetric and prevents one direction from silently diverging during later changes. */
      for (const [actionId, direction] of [['songNoteUp', 1], ['songNoteDown', -1]]) {
        if (outputs.buttons[actionId] && handleButtonEdge(actionId, true)) {
          const [minNote, maxNote] = SONG_NOTE_RANGE;
          const currentNote = typeof latest.songNote === 'number' ? latest.songNote : SONG_DEFAULT_NOTE;
          const candidate = currentNote + direction;
          const nextNote = candidate > maxNote ? minNote : candidate < minNote ? maxNote : candidate;
          latest.setSongNote(nextNote);
          latest.sendSong([{ note: nextNote, duration: SONG_DEFAULT_DURATION }], { slot: 0 });
        } else if (!outputs.buttons[actionId]) {
          handleButtonEdge(actionId, false);
        }
      }

      /* Room-control cycling differs only by target state, so both bindings use the same policy
         checks and ordered entity selection. */
      for (const [actionId, targetState] of [['homeAssistantOn', 'on'], ['homeAssistantOff', 'off']]) {
        if (outputs.buttons[actionId] && handleButtonEdge(actionId, true)) {
          cycleHomeAssistant(latest, targetState);
        } else if (!outputs.buttons[actionId]) {
          handleButtonEdge(actionId, false);
        }
      }

      /*
        PTZ zoom consumes the live signed gamepad axis, including its zero
        position, so releasing the stick is an explicit stop instead of merely
        ending calls to the old servo updater. Rover camera servos return false
        here and continue through their established absolute/velocity mapping.
      */
      const handledAsPtzZoom = latest.setCameraAxisIntent(outputs.cameraAxis);
      if (
        !handledAsPtzZoom &&
        (profile.calibration?.cameraMode === 'velocity' || Math.abs(outputs.cameraAxis) > 0.001)
      ) {
        handleCameraAxis(outputs.cameraAxis, profile.calibration);
      }

      /* Raw values remain in the dedicated hub used by diagnostics. The shared reducer only
         needs connection identity, which avoids forcing the entire provider through 60 updates/s. */
      if (lastRegisteredSignatureRef.current !== signature) {
        lastRegisteredSignatureRef.current = signature;
        latest.registerInputState(SOURCE, {
          connected: true,
          blocked: false,
          signature,
          id: activePad.id,
          index: activePad.index,
        });
      }
    });
    return () => {
      unsubscribe();
      const latest = latestRef.current;
      if (latest) neutralizeController(latest);
      markControllerDisconnected(lastConnectedSignatureRef.current);
    };
  }, [ensureProfile, handleButtonEdge, handleCameraAxis, neutralizeController]);

  return null;
}
