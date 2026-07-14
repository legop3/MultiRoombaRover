// Keyboard Input Manager
// Purpose: Captures and translates keyboard events into normalized control intents. Scope: Owns keydown/keyup listeners and dispatch coordination for drive controls.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useControlActions, useControlSelector } from '../ControlContext.jsx';
import { useChatActions, useChatFocus } from '../../context/ChatContext.jsx';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { normalizeKeymapEntries, tokensForEvent } from '../keymapUtils.js';
import { isKeyboardCaptureLocked } from './keyboardCaptureLock.js';
import { isTextInputElement } from './inputFocusUtils.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS, VIDEO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';
import {
  SONG_DEFAULT_DURATION,
  SONG_DEFAULT_NOTE,
  SONG_NOTE_RANGE,
  SONG_REPEAT_MS,
} from '../constants.js';
import {
  bindingActive,
  computeKeyboardAuxMotors,
  computeKeyboardDriveVector,
  getKeyboardDriveSpeedOptions,
  isPrecisionDriveActive,
  resolveKeyboardSpeeds,
} from './driveIntent.js';
import { trackAnalyticsEvent } from '../../analytics/index.js';

const SOURCE = 'keyboard';
const ZERO_VECTOR = { x: 0, y: 0, boost: false };
const ZERO_AUX = { main: 0, side: 0, vacuum: 0 };
const NOTE_MIN = SONG_NOTE_RANGE[0];
const NOTE_MAX = SONG_NOTE_RANGE[1];
const TILT_INTERVAL_MIN = 5;
const TILT_INTERVAL_MAX = 500;
const TILT_SPEED_MIN = 1;
const TILT_SPEED_MAX = 100;
const PRECISION_SERVO_NUDGE_DEGREES = 0.25;
const VIDEO_FILTER_SEQUENCE = ['none', 'grayscale', 'greenscale'];

function normalizeVideoFilter(value) {
  // The setting is persisted in a browser cookie and can become stale if filter names change.
  // Normalizing before cycling keeps the shortcut deterministic instead of getting stuck on an
  // unknown value.
  return VIDEO_FILTER_SEQUENCE.includes(value) ? value : VIDEO_SETTINGS_DEFAULTS.colorFilter;
}

function nextVideoFilter(value) {
  const current = normalizeVideoFilter(value);
  const currentIndex = VIDEO_FILTER_SEQUENCE.indexOf(current);

  // The modulo wrap intentionally makes the shortcut a simple single-key cycle:
  // Color -> Gray -> Green -> Color. That is faster while driving than needing separate keys.
  return VIDEO_FILTER_SEQUENCE[(currentIndex + 1) % VIDEO_FILTER_SEQUENCE.length];
}

function clampTiltInterval(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(TILT_INTERVAL_MIN, Math.min(TILT_INTERVAL_MAX, num));
}

function clampTiltSpeed(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(TILT_SPEED_MIN, Math.min(TILT_SPEED_MAX, num));
}

function mapTiltSpeedToInterval(speed) {
  const clampedSpeed = clampTiltSpeed(speed, speed);
  const ratio = (clampedSpeed - TILT_SPEED_MIN) / (TILT_SPEED_MAX - TILT_SPEED_MIN);
  const interval = TILT_INTERVAL_MAX - ratio * (TILT_INTERVAL_MAX - TILT_INTERVAL_MIN);
  return Math.round(interval);
}

function mapTiltIntervalToSpeed(interval) {
  const clampedInterval = clampTiltInterval(interval, interval);
  const ratio = (TILT_INTERVAL_MAX - clampedInterval) / (TILT_INTERVAL_MAX - TILT_INTERVAL_MIN);
  const speed = TILT_SPEED_MIN + ratio * (TILT_SPEED_MAX - TILT_SPEED_MIN);
  return Math.round(speed);
}

function shouldIgnoreEvent(event) {
  return isTextInputElement(event?.target);
}

export default function KeyboardInputManager() {
  const {
    setMode,
    setDriveVector,
    setAuxMotors,
    nudgeServo,
    runMacro,
    stopAllMotion,
    registerInputState,
    setCameraPrecisionMode,
    toggleHeadlight,
    toggleLaser,
    startHorn,
    stopHorn,
    setMicPttActive,
    setSongNote,
    sendSong,
  } = useControlActions();
  const rawKeymap = useControlSelector((control) => control.state.keymap);
  const cameraNudgeDegrees = useControlSelector((control) => control.state.camera?.config?.nudgeDegrees);
  const songNote = useControlSelector((control) => control.state.song?.note);
  const roverId = useControlSelector((control) => control.state.roverId);
  const hornActive = useControlSelector((control) => Boolean(control.state.horn?.active));
  const homeAssistant = useSessionSelector((state) => state.session?.homeAssistant || null);
  const role = useSessionSelector((state) => state.session?.role || null);
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const adminCanControlLockedLights = role === 'lockdown' || (role === 'admin' && mode !== 'lockdown');
  const dockAssist = useManualDockAssist();
  const { homeAssistantSetState, pushAlert } = useSessionActions();
  const { focusChat } = useChatActions();
  const { isChatFocused } = useChatFocus();
  const { value: inputSettings } = useSettingsNamespace('inputs', INPUT_SETTINGS_DEFAULTS);
  const { value: videoSettings, save: saveVideoSettings } = useSettingsNamespace('video', VIDEO_SETTINGS_DEFAULTS);
  const videoColorFilter = normalizeVideoFilter(videoSettings?.colorFilter);
  const keymap = useMemo(() => normalizeKeymapEntries(rawKeymap), [rawKeymap]);
  const actionTokens = useMemo(() => {
    const tokens = new Set();
    Object.values(keymap).forEach((bindingSet) => {
      if (!bindingSet) return;
      bindingSet.forEach((token) => tokens.add(token));
    });
    return tokens;
  }, [keymap]);
  const keyboardSpeeds = useMemo(() => {
    return resolveKeyboardSpeeds(inputSettings);
  }, [inputSettings]);
  const servoRepeatMs = useMemo(() => {
    const defaults = INPUT_SETTINGS_DEFAULTS.keyboard;
    const current = inputSettings?.keyboard ?? {};
    const tiltSpeed = clampTiltSpeed(
      typeof current.tiltSpeed === 'number'
        ? current.tiltSpeed
        : typeof current.tiltIntervalMs === 'number'
          ? mapTiltIntervalToSpeed(current.tiltIntervalMs)
          : defaults.tiltSpeed,
      defaults.tiltSpeed,
    );
    return mapTiltSpeedToInterval(tiltSpeed);
  }, [inputSettings?.keyboard]);
  const servoStep = useMemo(
    () => Math.abs(cameraNudgeDegrees || 1),
    [cameraNudgeDegrees],
  );

  const activeTokensRef = useRef(new Set());
  const lastVectorRef = useRef(ZERO_VECTOR);
  const lastAuxRef = useRef(ZERO_AUX);
  const servoIntervalRef = useRef(null);
  const songIntervalRef = useRef(null);
  const hornActiveRef = useRef(false);
  // Global keyboard listeners must stay mounted while React state churns underneath them. This
  // ref is rewritten after every commit so the stable handlers can still use fresh settings,
  // keymaps, and action callbacks without making listener registration depend on those values.
  const latestRef = useRef(null);

  const driveFromKeys = useCallback(() => {
    const latest = latestRef.current;
    if (!latest) return;
    const tokensSnapshot = new Set(activeTokensRef.current);
    const precisionActive = isPrecisionDriveActive(tokensSnapshot, latest.keymap);
    const speedOptions = getKeyboardDriveSpeedOptions(tokensSnapshot, latest.keymap, latest.keyboardSpeeds);
    const vector = computeKeyboardDriveVector(tokensSnapshot, latest.keymap);
    const aux = computeKeyboardAuxMotors(tokensSnapshot, latest.keymap);
    /*
      Keyboard precision is a held modifier, so publish the camera precision
      state from the same token snapshot that drives movement. This keeps the
      servo UI in lockstep with the actual precision-driving intent.
    */
    latest.setCameraPrecisionMode(precisionActive);
    if (
      vector.x !== lastVectorRef.current.x ||
      vector.y !== lastVectorRef.current.y ||
      vector.boost !== lastVectorRef.current.boost
    ) {
      lastVectorRef.current = vector;
      latest.setDriveVector(vector, { source: SOURCE, speedOptions });
    }
    if (
      aux.main !== lastAuxRef.current.main ||
      aux.side !== lastAuxRef.current.side ||
      aux.vacuum !== lastAuxRef.current.vacuum
    ) {
      lastAuxRef.current = aux;
      latest.setAuxMotors(aux);
    }
    latest.registerInputState(SOURCE, {
      keys: Array.from(tokensSnapshot),
      vector,
      aux,
    });
  }, []);

  const stopServoLoop = useCallback(() => {
    if (servoIntervalRef.current) {
      clearTimeout(servoIntervalRef.current);
      servoIntervalRef.current = null;
    }
  }, []);

  const computeServoDirection = useCallback(() => {
    const latest = latestRef.current;
    if (!latest) return 0;
    const tokensSnapshot = new Set(activeTokensRef.current);
    const up = bindingActive(latest.keymap.cameraUp, tokensSnapshot);
    const down = bindingActive(latest.keymap.cameraDown, tokensSnapshot);
    return (up ? 1 : 0) - (down ? 1 : 0);
  }, []);

  const ensureServoLoop = useCallback(() => {
    const direction = computeServoDirection();
    if (direction === 0) {
      stopServoLoop();
      return;
    }
    if (servoIntervalRef.current) {
      return;
    }
    const tick = () => {
      const nextDirection = computeServoDirection();
      if (nextDirection === 0) {
        stopServoLoop();
        return;
      }
      const latest = latestRef.current;
      if (!latest) {
        stopServoLoop();
        return;
      }
      const tokensSnapshot = new Set(activeTokensRef.current);
      const precisionActive = isPrecisionDriveActive(tokensSnapshot, latest.keymap);
      const servoStep = precisionActive ? PRECISION_SERVO_NUDGE_DEGREES : latest.servoStep;
      latest.nudgeServo(nextDirection * servoStep);
      servoIntervalRef.current = setTimeout(tick, latest.servoRepeatMs);
    };
    servoIntervalRef.current = setTimeout(tick, 0);
  }, [computeServoDirection, stopServoLoop]);

  const stopSongLoop = useCallback(() => {
    if (songIntervalRef.current) {
      clearTimeout(songIntervalRef.current);
      songIntervalRef.current = null;
    }
  }, []);

  const computeSongDirection = useCallback(() => {
    const latest = latestRef.current;
    if (!latest) return 0;
    const tokensSnapshot = new Set(activeTokensRef.current);
    const up = bindingActive(latest.keymap.songNoteUp, tokensSnapshot);
    const down = bindingActive(latest.keymap.songNoteDown, tokensSnapshot);
    return (up ? 1 : 0) - (down ? 1 : 0);
  }, []);

  const triggerSongChange = useCallback((direction) => {
    const latest = latestRef.current;
    if (!latest || direction === 0) return;
    const current = typeof latest.songNote === 'number' ? latest.songNote : SONG_DEFAULT_NOTE;
    let next = current + direction;
    if (next > NOTE_MAX) {
      next = NOTE_MIN;
    } else if (next < NOTE_MIN) {
      next = NOTE_MAX;
    }
    const finalNote = latest.setSongNote(next);
    latest.sendSong([{ note: finalNote, duration: SONG_DEFAULT_DURATION }], { slot: 0 });
  }, []);

  const ensureSongLoop = useCallback(() => {
    const direction = computeSongDirection();
    if (direction === 0) {
      stopSongLoop();
      return;
    }
    if (songIntervalRef.current) {
      return;
    }
    const tick = () => {
      const nextDirection = computeSongDirection();
      if (nextDirection === 0) {
        stopSongLoop();
        return;
      }
      triggerSongChange(nextDirection);
      songIntervalRef.current = setTimeout(tick, SONG_REPEAT_MS);
    };
    songIntervalRef.current = setTimeout(tick, 0);
  }, [computeSongDirection, stopSongLoop, triggerSongChange]);

  const resetAll = useCallback(() => {
    const latest = latestRef.current;
    activeTokensRef.current.clear();
    lastVectorRef.current = ZERO_VECTOR;
    lastAuxRef.current = ZERO_AUX;
    stopServoLoop();
    stopSongLoop();
    if (hornActiveRef.current) {
      hornActiveRef.current = false;
      latest?.stopHorn();
    }
    latest?.setMicPttActive(false);
    latest?.setCameraPrecisionMode(false);
    latest?.stopAllMotion();
    latest?.registerInputState(SOURCE, { keys: [], vector: ZERO_VECTOR, aux: ZERO_AUX });
  }, [stopServoLoop, stopSongLoop]);

  const triggerHomeAssistantCycle = useCallback((targetState) => {
    const latest = latestRef.current;
    const ha = latest?.homeAssistant;
    if (!ha?.enabled || !ha?.connected) return;
    /*
      Room-light lock disables keyboard cycling for normal users because those
      shortcuts are part of the public room-control surface. Admin sessions are
      allowed through when the current site mode would also allow their socket
      command, so keyboard behavior matches the server-side authorization and
      the clickable Room Controls panel.
    */
    if ((ha?.lightPolicy?.locked || ha?.lightPolicy?.lockedOn) && !latest?.adminCanControlLockedLights) return;
    const entities = ha.entities || [];
    const eligible = entities.filter(
      (ent) =>
        (ent.type === 'light' || ent.type === 'switch') &&
        ent.available !== false &&
        ent.state !== 'unavailable',
    );
    if (eligible.length === 0) return;
    if (targetState === 'on') {
      const next = eligible.find((ent) => ent.state !== 'on');
      if (next) {
        latest.homeAssistantSetState(next.id, 'on').catch(() => {});
      }
      return;
    }
    if (targetState === 'off') {
      for (let idx = eligible.length - 1; idx >= 0; idx -= 1) {
        const ent = eligible[idx];
        if (ent.state === 'on') {
          latest.homeAssistantSetState(ent.id, 'off').catch(() => {});
          break;
        }
      }
    }
  }, []);

  const cycleVideoFilter = useCallback(() => {
    // Update through the same settings namespace as the Page settings dropdown so the keyboard
    // shortcut and menu never maintain separate copies of the selected filter.
    const latest = latestRef.current;
    if (!latest) return;
    const nextFilter = nextVideoFilter(latest.videoColorFilter);
    latest.saveVideoSettings((current) => ({
      ...(current ?? {}),
      colorFilter: nextFilter,
    }));
    latest.pushAlert({
      // Reuse one alert lane for filter changes so fast key-repeat-like cycling refreshes the
      // indicator instead of covering the interface with a stack of filter toasts.
      id: 'video-filter-active',
      title: 'Video filter',
      // The message intentionally uses the raw filter key; no label mapping is needed because
      // these are the same keys persisted in the setting and cycled by the shortcut.
      message: `Rover video filter: ${nextFilter}`,
      color: '#38bdf8',
      lifetimeMs: 1600,
    });
  }, []);

  useLayoutEffect(() => {
    // The assignment lives in a layout effect instead of render because the current React lint
    // rules reserve refs for effects and event handlers. Layout timing keeps the ref current
    // before the browser can deliver the next keyboard event after a committed render.
    latestRef.current = {
      actionTokens,
      dockAssist,
      focusChat,
      homeAssistant,
      homeAssistantSetState,
      isChatFocused,
      adminCanControlLockedLights,
      keyboardSpeeds,
      keymap,
      nudgeServo,
      pushAlert,
      registerInputState,
      roverId,
      runMacro,
      saveVideoSettings,
      sendSong,
      servoRepeatMs,
      servoStep,
      setAuxMotors,
      setCameraPrecisionMode,
      setDriveVector,
      setMicPttActive,
      setMode,
      setSongNote,
      songNote,
      startHorn,
      stopAllMotion,
      stopHorn,
      toggleHeadlight,
      toggleLaser,
      videoColorFilter,
    };
  });

  useEffect(() => {
    function handleKeyDown(event) {
      const latest = latestRef.current;
      if (!latest) return;
      if (isKeyboardCaptureLocked()) return;
      if (shouldIgnoreEvent(event)) return;
      const tokens = tokensForEvent(event);
      if (tokens.length === 0) return;
      const tokenSet = new Set(tokens);
      if (bindingActive(latest.keymap.chatFocus, tokenSet)) {
        event.preventDefault();
        resetAll();
        if (!latest.isChatFocused) {
          latest.focusChat();
        }
        return;
      }
      if (tokens.some((token) => latest.actionTokens.has(token))) {
        event.preventDefault();
      }
      const newlyPressed = tokens.filter((token) => !activeTokensRef.current.has(token));
      newlyPressed.forEach((token) => activeTokensRef.current.add(token));

      if (newlyPressed.length > 0) {
        if (newlyPressed.some((token) => latest.keymap.driveMacro?.has(token))) {
          trackAnalyticsEvent('drive_start', { roverId: latest.roverId || '', source: 'keyboard' });
          latest.dockAssist.exitAssist();
          latest.setMode('drive');
          latest.runMacro('drive-sequence');
        } else if (newlyPressed.some((token) => latest.keymap.dockMacro?.has(token))) {
          trackAnalyticsEvent('dock_assist_toggle', { roverId: latest.roverId || '', source: 'keyboard' });
          latest.dockAssist.toggleAssist();
        } else if (newlyPressed.some((token) => latest.keymap.headlightToggle?.has(token))) {
          trackAnalyticsEvent('headlight_toggle', { roverId: latest.roverId || '', source: 'keyboard' });
          latest.toggleHeadlight();
        } else if (newlyPressed.some((token) => latest.keymap.laserToggle?.has(token))) {
          trackAnalyticsEvent('laser_toggle', { roverId: latest.roverId || '', source: 'keyboard' });
          latest.toggleLaser();
        } else if (newlyPressed.some((token) => latest.keymap.videoFilterCycle?.has(token))) {
          cycleVideoFilter();
        } else if (newlyPressed.some((token) => latest.keymap.hornHonk?.has(token))) {
          if (!hornActiveRef.current) {
            const started = latest.startHorn();
            hornActiveRef.current = Boolean(started);
          }
        } else if (newlyPressed.some((token) => latest.keymap.micPtt?.has(token))) {
          latest.setMicPttActive(true);
        } else if (newlyPressed.some((token) => latest.keymap.homeAssistantOn?.has(token))) {
          triggerHomeAssistantCycle('on');
        } else if (newlyPressed.some((token) => latest.keymap.homeAssistantOff?.has(token))) {
          triggerHomeAssistantCycle('off');
        }
      }

      ensureServoLoop();
      ensureSongLoop();
      driveFromKeys();
    }

    function handleKeyUp(event) {
      const latest = latestRef.current;
      if (!latest) return;
      if (isKeyboardCaptureLocked()) return;
      const tokens = tokensForEvent(event);
      tokens.forEach((token) => activeTokensRef.current.delete(token));
      if (hornActiveRef.current && !bindingActive(latest.keymap.hornHonk, activeTokensRef.current)) {
        hornActiveRef.current = false;
        latest.stopHorn();
      }
      if (!bindingActive(latest.keymap.micPtt, activeTokensRef.current)) {
        latest.setMicPttActive(false);
      }
      ensureServoLoop();
      ensureSongLoop();
      driveFromKeys();
    }

    function handleBlur() {
      resetAll();
    }

    // The global listeners are intentionally registered through stable handlers. High-frequency
    // control context updates should refresh latestRef.current, not force the browser to detach
    // and reattach window listeners while someone may be driving.
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', handleBlur);
    };
  }, [cycleVideoFilter, driveFromKeys, ensureServoLoop, ensureSongLoop, resetAll, triggerHomeAssistantCycle]);

  const latestResetAllRef = useRef(resetAll);
  useEffect(() => {
    latestResetAllRef.current = resetAll;
  }, [resetAll]);

  useEffect(() => {
    latestResetAllRef.current();
  }, [roverId]);

  useEffect(() => {
    hornActiveRef.current = hornActive;
  }, [hornActive]);

  useEffect(
    () => () => {
      stopServoLoop();
      stopSongLoop();
    },
    [stopServoLoop, stopSongLoop],
  );

  return null;
}
