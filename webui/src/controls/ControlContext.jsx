// Control Context Provider
// Purpose: Exposes control-system state/actions to control-capable components. Scope: Owns reducer wiring, pipeline integration, and top-level provider hooks.
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { controlReducer, initialControlState } from './controlReducer.js';
import { computeDifferentialSpeeds, clamp } from './controlMath.js';
import { useCommandPipeline } from './commandPipeline.js';
import {
  DEFAULT_KEYMAP,
  DEFAULT_MACROS,
  HORN_HEAT_COOL_PER_SEC,
  HORN_HEAT_RESUME_THRESHOLD,
  HORN_HEAT_UP_PER_SEC,
  HORN_MAX_FREQUENCY,
  HORN_MAX_MS,
  MANUAL_DOCK_ASSIST_MAX_SPEED,
  SONG_DEFAULT_NOTE,
} from './constants.js';
import { canonicalizeKeyInput } from './keymapUtils.js';
import { useSettingsNamespace } from '../settings/index.js';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';
import { HORN_SETTINGS_DEFAULTS } from '../settings/namespaces.js';
import { useOvercurrentLimiter } from './overcurrentLimiter.js';
import { usePtzControlAdapter } from './ptzControlAdapter.js';

const ControlSystemContext = createContext(null);

function normalizeSelector(selector) {
  return typeof selector === 'function' ? selector : (snapshot) => snapshot;
}

const CONTROL_ACTION_NAMES = [
  'setMode',
  'setDriveVector',
  'setAuxMotors',
  'setServoAngle',
  'nudgeServo',
  'setCameraAxisIntent',
  'goServoHome',
  'setCameraPrecisionMode',
  'runMacro',
  'stopAllMotion',
  'sendOiCommand',
  'setSensorStream',
  'setHeadlight',
  'toggleHeadlight',
  'setLaser',
  'toggleLaser',
  'updateKeyBinding',
  'resetKeyBindings',
  'registerInputState',
  'setManualDockAssistActive',
  'toggleManualDockAssist',
  'setSongNote',
  'sendSong',
  'startHorn',
  'stopHorn',
  'setMicPttActive',
];

function cloneKeymap(map) {
  return Object.fromEntries(
    Object.entries(map || {}).map(([key, values]) => [key, Array.isArray(values) ? [...values] : []]),
  );
}

function clampServoAngle(config, value) {
  if (!config) return value;
  const min = typeof config.minAngle === 'number' ? config.minAngle : -45;
  const max = typeof config.maxAngle === 'number' ? config.maxAngle : 45;
  return clamp(value, min, max);
}

function removeDriveSequenceBackoff(steps = []) {
  if (!Array.isArray(steps) || steps.length < 3) return steps;
  const last3 = steps.slice(-3);
  const [backoffStep, pauseStep, stopStep] = last3;
  const isBackoffStep =
    backoffStep?.type === 'drive' &&
    Number(backoffStep?.speeds?.left) === -300 &&
    Number(backoffStep?.speeds?.right) === -300;
  const isPauseStep = pauseStep?.type === 'pause' && Number(pauseStep?.duration) === 600;
  const isStopStep =
    stopStep?.type === 'drive' &&
    Number(stopStep?.speeds?.left) === 0 &&
    Number(stopStep?.speeds?.right) === 0;
  if (!isBackoffStep || !isPauseStep || !isStopStep) return steps;
  return steps.slice(0, -3);
}

export function ControlSystemProvider({ children }) {
  const [state, dispatch] = useReducer(controlReducer, initialControlState);
  const snapshotRef = useRef(null);
  const subscribersRef = useRef(new Set());
  const actionImplementationsRef = useRef({});
  const [stableActions] = useState(() => {
    /*
      Public action functions intentionally keep stable identities. Each wrapper
      reads the current implementation at call time, so consumers can depend on
      actions without re-rendering just because the real implementation now
      closes over a new state slice, pipeline object, or settings value.
    */
    return Object.fromEntries(
      CONTROL_ACTION_NAMES.map((name) => [
        name,
        (...args) => actionImplementationsRef.current[name]?.(...args),
      ]),
    );
  }, []);
  const getControlSnapshot = useCallback(() => snapshotRef.current, []);
  const subscribeControlSnapshot = useCallback((selector, listener, equalityFn = Object.is) => {
    const normalizedSelector = normalizeSelector(selector);
    const currentSnapshot = snapshotRef.current;
    const subscriber = {
      selector: normalizedSelector,
      equalityFn,
      listener,
      current: normalizedSelector(currentSnapshot),
    };
    subscribersRef.current.add(subscriber);
    return () => {
      subscribersRef.current.delete(subscriber);
    };
  }, []);
  const notifyControlSubscribers = useCallback((nextSnapshot) => {
    /*
      The provider context value below is stable, so React will not fan out an
      update to every consumer automatically. This loop is the replacement: it
      asks each subscribed component whether the exact value it selected changed
      and only wakes that component when its selected value is different.
    */
    subscribersRef.current.forEach((subscriber) => {
      const nextSelected = subscriber.selector(nextSnapshot);
      if (!subscriber.equalityFn(subscriber.current, nextSelected)) {
        subscriber.current = nextSelected;
        subscriber.listener(nextSelected);
      }
    });
  }, []);
  const prevModeRef = useRef(null);
  const pendingLightsRef = useRef(false);
  const servoAngleRef = useRef(initialControlState.camera.angle);
  const hornAutoStopRef = useRef(null);
  const hornStartAtRef = useRef(0);
  const hornHeatTickRef = useRef(0);
  const {
    value: controlSettings,
    save: saveControlSettings,
  } = useSettingsNamespace('controls', { keymap: DEFAULT_KEYMAP, macros: DEFAULT_MACROS });
  const { value: pageSettings } = useSettingsNamespace('page', { driveMacroBackoffEnabled: true });
  const { value: hornSettings } = useSettingsNamespace('horn', HORN_SETTINGS_DEFAULTS);
  const driveMacroBackoffEnabled =
    typeof pageSettings?.driveMacroBackoffEnabled === 'boolean'
      ? pageSettings.driveMacroBackoffEnabled
      : true;
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const homeAssistantEntities = useSessionSelector((state) => state.session?.homeAssistant?.entities ?? []);
  const roomLightsLocked = useSessionSelector((state) =>
    Boolean(state.session?.homeAssistant?.lightPolicy?.locked || state.session?.homeAssistant?.lightPolicy?.lockedOn),
  );
  const roomLightsLockedOn = useSessionSelector((state) =>
    Boolean(state.session?.homeAssistant?.lightPolicy?.lockedOn),
  );
  const { homeAssistantSetState } = useSessionActions();
  const overcurrentLimiter = useOvercurrentLimiter(roverId);
  /*
    Motor commands now remain raw until they reach the server-owned protection
    service. Applying another transform here would make non-admin commands pass
    through two independent limiters and would let browser lifecycle determine
    whether protection exists at all.
  */
  const pipeline = useCommandPipeline();
  const ptzControls = usePtzControlAdapter();

  const turnOnAllLights = useCallback(() => {
    /*
      Automatic drive-mode lighting is convenience behavior for the open room.
      A room-light lock is an explicit policy decision, including locked-off,
      so this helper must not issue any Home Assistant commands while that
      policy is active. Admins can still use the dedicated room controls when
      they need to override individual lamps.
    */
    if (roomLightsLocked) {
      pendingLightsRef.current = false;
      return;
    }
    const entities = homeAssistantEntities || [];
    const targets = entities.filter(
      (ent) =>
        (ent.type === 'light' || ent.type === 'switch') &&
        ent.available !== false &&
        ent.state !== 'on',
    );
    if (targets.length === 0) {
      pendingLightsRef.current = false;
      return;
    }
    pendingLightsRef.current = true;
    targets.forEach((ent) => {
      homeAssistantSetState(ent.id, 'on').catch(() => {});
    });
    // Give the loop a chance; clear pending after issuing commands.
    pendingLightsRef.current = false;
  }, [homeAssistantEntities, homeAssistantSetState, roomLightsLocked]);

  useEffect(() => {
    dispatch({ type: 'control/set-rover', payload: pipeline.roverId });
  }, [pipeline.roverId]);

  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = state.mode;
    if (prevMode !== 'drive' && state.mode === 'drive' && homeAssistantEntities?.length) {
      turnOnAllLights();
    } else if (prevMode !== 'drive' && state.mode === 'drive') {
      pendingLightsRef.current = true;
    }
  }, [state.mode, homeAssistantEntities, turnOnAllLights]);

  useEffect(() => {
    if (pendingLightsRef.current && homeAssistantEntities?.length) {
      turnOnAllLights();
    }
  }, [homeAssistantEntities, turnOnAllLights]);

  useEffect(() => {
    const mergedKeymap = { ...DEFAULT_KEYMAP, ...(controlSettings?.keymap || {}) };
    dispatch({ type: 'control/set-keymap', payload: mergedKeymap });
    if (controlSettings?.macros) {
      dispatch({ type: 'control/set-macros', payload: controlSettings.macros });
    }
  }, [controlSettings?.keymap, controlSettings?.macros]);

  useEffect(() => {
    const config = pipeline.servoConfig;
    if (!config) {
      dispatch({ type: 'control/set-camera-config', payload: { config: null } });
      servoAngleRef.current = null;
      return;
    }
    const min = typeof config.minAngle === 'number' ? config.minAngle : -45;
    const max = typeof config.maxAngle === 'number' ? config.maxAngle : 45;
    const base = typeof config.homeAngle === 'number' ? config.homeAngle : (min + max) / 2;
    const preserved =
      typeof servoAngleRef.current === 'number' ? clamp(servoAngleRef.current, min, max) : null;
    const angle = preserved != null ? preserved : clamp(base, min, max);
    dispatch({
      type: 'control/set-camera-config',
      payload: { config, angle },
    });
    servoAngleRef.current = angle;
  }, [pipeline.servoConfig]);

  useEffect(() => {
    servoAngleRef.current =
      typeof state.camera.angle === 'number' ? state.camera.angle : servoAngleRef.current;
  }, [state.camera.angle]);

  useEffect(() => {
    if (pipeline.roverId) {
      pipeline.enableSensorStream();
    }
  }, [pipeline.roverId, pipeline.enableSensorStream]);

  const setMode = useCallback(
    (mode) => {
      dispatch({ type: 'control/set-mode', payload: mode });
    },
    [],
  );

  const recordControlIntent = useCallback(() => {
    dispatch({ type: 'control/record-intent' });
  }, []);

  const setDriveVector = useCallback(
    (vector, meta = {}) => {
      const speedOptions = { ...(meta.speedOptions || {}) };
      if (state.manualDockAssist?.active) {
        const capped = Math.max(1, Math.min(MANUAL_DOCK_ASSIST_MAX_SPEED, 500));
        speedOptions.maxSpeed = Math.min(
          typeof speedOptions.maxSpeed === 'number' ? speedOptions.maxSpeed : capped,
          capped,
        );
        speedOptions.baseSpeed = Math.min(
          typeof speedOptions.baseSpeed === 'number' ? speedOptions.baseSpeed : capped,
          capped,
        );
        speedOptions.boostSpeed = Math.min(
          typeof speedOptions.boostSpeed === 'number' ? speedOptions.boostSpeed : capped,
          capped,
        );
      }
      const computed = computeDifferentialSpeeds(vector, speedOptions);
      dispatch({
        type: 'control/update-drive',
        payload: { ...computed, source: meta.source ?? null },
      });
      recordControlIntent();
      if (ptzControls.applyDriveVector(vector, meta)) return;
      pipeline.sendDriveDirect(computed.speeds);
    },
    [pipeline, ptzControls, recordControlIntent, state.manualDockAssist?.active],
  );

  const setAuxMotors = useCallback(
    (values = {}) => {
      const payload = pipeline.sendAuxMotors(values) ?? values;
      dispatch({
        type: 'control/set-aux-motors',
        payload,
      });
      recordControlIntent();
    },
    [pipeline, recordControlIntent],
  );

  const updateKeyBinding = useCallback(
    (bindingId, keyValue) => {
      if (!bindingId) return false;
      const canonical = canonicalizeKeyInput(keyValue);
      if (!canonical) return false;
      const next = cloneKeymap(state.keymap);
      next[bindingId] = [canonical];
      dispatch({ type: 'control/set-keymap', payload: next });
      saveControlSettings((current) => ({
        ...(current ?? {}),
        keymap: next,
      }));
      return true;
    },
    [state.keymap, saveControlSettings],
  );

  const resetKeyBindings = useCallback(() => {
    const defaults = cloneKeymap(DEFAULT_KEYMAP);
    dispatch({ type: 'control/set-keymap', payload: defaults });
    saveControlSettings((current) => ({
      ...(current ?? {}),
      keymap: defaults,
    }));
  }, [saveControlSettings]);

  const setServoAngle = useCallback(
    (value, options = {}) => {
      /*
        Absolute servo positions belong only to rover hardware. PTZ zoom now
        enters through setCameraAxisIntent as a signed held velocity, so this
        function must not infer zoom direction by comparing unrelated absolute
        angle values from gamepad/manual-dock callers.
      */
      if (!pipeline.servoConfig) return;
      const force = Boolean(options?.force);
      if (state.manualDockAssist?.active && !force) return;
      const clamped = clampServoAngle(pipeline.servoConfig, value);
      dispatch({ type: 'control/set-camera-angle', payload: clamped });
      pipeline.sendServoAngle(clamped);
      servoAngleRef.current = clamped;
      recordControlIntent();
    },
    [pipeline, recordControlIntent, state.manualDockAssist?.active],
  );

  const nudgeServo = useCallback(
    (delta = 0) => {
      if (ptzControls.isActive) {
        /*
          A PTZ camera has no absolute browser-side servo angle. Treat a nudge
          as held zoom direction and, importantly, preserve zero as an explicit
          release. The previous fallback converted nudgeServo(0) into a positive
          default step, so releasing the mobile zoom button could zoom in again.
        */
        ptzControls.setZoomIntent(delta);
        recordControlIntent();
        return;
      }
      const config = pipeline.servoConfig;
      if (!config) return;
      const step = typeof delta === 'number' && delta !== 0 ? delta : config?.nudgeDegrees || 1;
      const baseline =
        typeof servoAngleRef.current === 'number'
          ? servoAngleRef.current
          : typeof config?.homeAngle === 'number'
          ? config.homeAngle
          : 0;
      setServoAngle(baseline + step);
    },
    [pipeline.servoConfig, ptzControls, recordControlIntent, setServoAngle],
  );

  const setCameraAxisIntent = useCallback(
    (direction = 0) => {
      /*
        Keyboard, touch, and gamepad all need an explicit way to say that a
        camera axis returned to neutral. Rover servos remain position/nudge
        based, so returning false tells those callers to continue through their
        existing rover implementation without introducing PTZ rules there.
      */
      if (!ptzControls.isActive) return false;
      ptzControls.setZoomIntent(direction);
      /*
        Do not dispatch recordControlIntent here. Gamepads publish their neutral
        and held axes every animation frame; the PTZ adapter deduplicates state
        and owns its 250 ms heartbeat, so a React reducer update per frame would
        add churn without representing a new user action.
      */
      return true;
    },
    [ptzControls],
  );

  const goServoHome = useCallback(() => {
    const config = pipeline.servoConfig;
    if (!config) return;
    const target =
      typeof config.homeAngle === 'number'
        ? config.homeAngle
        : typeof config.minAngle === 'number' && typeof config.maxAngle === 'number'
        ? (config.minAngle + config.maxAngle) / 2
        : 0;
    setServoAngle(target);
  }, [pipeline.servoConfig, setServoAngle]);

  const setCameraPrecisionMode = useCallback((active) => {
    /*
      This action only changes how the browser chooses servo increments. The Pi
      already accepts decimal angle targets, so no server or rover command shape
      changes are needed for precision camera mode.
    */
    dispatch({ type: 'control/set-camera-precision-mode', payload: Boolean(active) });
  }, []);

  const runMacro = useCallback(
    async (macroId) => {
      const macro = state.macros.find((item) => item.id === macroId) || null;
      if (!macro) return;
      let macroToRun = macro;
      if (macroId === 'drive-sequence') {
        turnOnAllLights();
        if (!homeAssistantEntities?.length) {
          pendingLightsRef.current = true;
        }
        recordControlIntent();
        if (!driveMacroBackoffEnabled) {
          macroToRun = {
            ...macro,
            steps: removeDriveSequenceBackoff(macro.steps),
          };
        }
      }
      await pipeline.runMacroSteps(macroToRun);
    },
    [
      driveMacroBackoffEnabled,
      pipeline,
      recordControlIntent,
      homeAssistantEntities,
      state.macros,
      turnOnAllLights,
    ],
  );

  const stopAllMotion = useCallback(() => {
    dispatch({
      type: 'control/update-drive',
      payload: {
        vector: { x: 0, y: 0, boost: false },
        speeds: { left: 0, right: 0 },
        source: 'system-stop',
      },
    });
    if (ptzControls.isActive) {
      ptzControls.stopMotion();
      return;
    }
    pipeline.sendDriveDirect({ left: 0, right: 0 });
    pipeline.sendAuxMotors({ main: 0, side: 0, vacuum: 0 });
  }, [pipeline, ptzControls]);

  const sendOiCommand = useCallback(
    (command) => {
      pipeline.sendOiCommand(command);
    },
    [pipeline],
  );

  const setSensorStream = useCallback(
    (enable) => {
      if (!pipeline.roverId) return;
      pipeline.emitCommand({
        type: 'sensorStream',
        data: { sensorStream: { enable } },
      });
    },
    [pipeline],
  );

  const setHeadlight = useCallback(
    (headlightOn) => {
      if (ptzControls.setSpotlight(headlightOn)) {
        recordControlIntent();
        return;
      }
      if (!pipeline.headlight) return;
      // Web controls now speak in logical device state. Any electrical
      // inversion needed by the actual GPIO driver is handled by roverd's
      // activeLow config, so this command stays readable and direct.
      const action = typeof headlightOn === 'boolean' ? (headlightOn ? 'on' : 'off') : 'toggle';
      pipeline.sendHeadlight(action);
      recordControlIntent();
    },
    [pipeline, ptzControls, recordControlIntent],
  );

  const toggleHeadlight = useCallback(() => {
    setHeadlight();
  }, [setHeadlight]);

  const setLaser = useCallback(
    (laserOn) => {
      if (ptzControls.setIr(laserOn)) {
        recordControlIntent();
        return;
      }
      if (!pipeline.laser) return;
      if (roomLightsLockedOn && laserOn !== false) return;
      // The laser shares the same logical toggle contract as the headlight; it
      // is separate only because it has its own GPIO pin, UI control, and keybind.
      const action = typeof laserOn === 'boolean' ? (laserOn ? 'on' : 'off') : 'toggle';
      pipeline.sendLaser(action);
      recordControlIntent();
    },
    [pipeline, ptzControls, recordControlIntent, roomLightsLockedOn],
  );

  const toggleLaser = useCallback(() => {
    setLaser();
  }, [setLaser]);

  const setSongNote = useCallback(
    (note) => {
      const next = typeof note === 'number' ? note : SONG_DEFAULT_NOTE;
      dispatch({ type: 'control/set-song-note', payload: next });
      return next;
    },
    [],
  );

  const sendSong = useCallback(
    (notes, options) => {
      return pipeline.sendSong(notes, options);
    },
    [pipeline],
  );

  const normalizedHornSettings = useMemo(() => {
    const base = hornSettings ?? HORN_SETTINGS_DEFAULTS;
    const waveform = base.waveform === 'sine' ? 'sine' : 'saw';
    const freqs = Array.isArray(base.freqs) ? base.freqs : HORN_SETTINGS_DEFAULTS.freqs;
    const normalized = [...freqs, 0, 0, 0, 0]
      .slice(0, 4)
      .map((value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return num <= 0 ? 0 : Math.min(HORN_MAX_FREQUENCY, Math.round(num));
      });
    return { waveform, freqs: normalized };
  }, [hornSettings]);

  const stopHornRef = useRef(null);

  const startHorn = useCallback(() => {
    if (!pipeline.horn) return;
    if (state.horn?.overheated) return false;
    if ((state.horn?.heat ?? 0) >= 1) return false;
    if (state.horn?.active) return false;
    const now = Date.now();
    pipeline.sendHorn({ action: 'start', ...normalizedHornSettings });
    dispatch({ type: 'control/set-horn-active', payload: true });
    hornStartAtRef.current = now;
    hornHeatTickRef.current = now;
    if (hornAutoStopRef.current) {
      clearTimeout(hornAutoStopRef.current);
      hornAutoStopRef.current = null;
    }
    hornAutoStopRef.current = setTimeout(() => {
      stopHornRef.current?.();
    }, HORN_MAX_MS);
    recordControlIntent();
    return true;
  }, [dispatch, normalizedHornSettings, pipeline, recordControlIntent, state.horn?.active, state.horn?.heat, state.horn?.overheated]);

  const stopHorn = useCallback(() => {
    if (!pipeline.horn) return;
    pipeline.sendHorn({ action: 'stop' });
    dispatch({ type: 'control/set-horn-active', payload: false });
    if (hornAutoStopRef.current) {
      clearTimeout(hornAutoStopRef.current);
      hornAutoStopRef.current = null;
    }
    const now = Date.now();
    const startedAt = hornStartAtRef.current || now;
    const holdMs = Math.max(0, now - startedAt);
    hornStartAtRef.current = 0;
    if (holdMs > 0) {
      const currentHeat = state.horn?.heat ?? 0;
      const added = (holdMs / 1000) * HORN_HEAT_UP_PER_SEC;
      let nextHeat = Math.max(0, Math.min(1, currentHeat + added));
      let nextOverheated = state.horn?.overheated ?? false;
      if (nextHeat >= 1) {
        nextHeat = 1;
        nextOverheated = true;
      }
      dispatch({ type: 'control/set-horn-heat', payload: { heat: nextHeat, overheated: nextOverheated } });
    }
  }, [dispatch, pipeline, state.horn?.heat, state.horn?.overheated]);

  const hornStateRef = useRef({
    active: Boolean(state.horn?.active),
    heat: state.horn?.heat ?? 0,
    overheated: Boolean(state.horn?.overheated),
  });
  useEffect(() => {
    hornStateRef.current = {
      active: Boolean(state.horn?.active),
      heat: state.horn?.heat ?? 0,
      overheated: Boolean(state.horn?.overheated),
    };
  }, [state.horn?.active, state.horn?.heat, state.horn?.overheated]);

  useEffect(() => {
    stopHornRef.current = stopHorn;
  }, [stopHorn]);

  const hornNeedsTick = Boolean(state.horn?.active) || (state.horn?.heat ?? 0) > 0 || Boolean(state.horn?.overheated);
  useEffect(() => {
    if (!hornNeedsTick) return undefined;
    const tickMs = 100;
    const interval = setInterval(() => {
      const now = Date.now();
      const last = hornHeatTickRef.current || now;
      hornHeatTickRef.current = now;
      const dt = Math.min(1000, Math.max(0, now - last)) / 1000;
      const current = hornStateRef.current;
      const currentHeat = current.heat ?? 0;
      const active = Boolean(current.active);
      const overheated = Boolean(current.overheated);
      const delta = dt * (active ? HORN_HEAT_UP_PER_SEC : -HORN_HEAT_COOL_PER_SEC);
      let nextHeat = Math.max(0, Math.min(1, currentHeat + delta));
      let nextOverheated = overheated;
      if (nextHeat >= 1) {
        nextHeat = 1;
        nextOverheated = true;
        if (active) {
          stopHornRef.current();
        }
      } else if (nextOverheated && nextHeat <= HORN_HEAT_RESUME_THRESHOLD) {
        nextOverheated = false;
      }
      if (nextHeat !== currentHeat || nextOverheated !== overheated) {
        dispatch({ type: 'control/set-horn-heat', payload: { heat: nextHeat, overheated: nextOverheated } });
      }
    }, tickMs);
    return () => clearInterval(interval);
  }, [dispatch, hornNeedsTick]);

  const setManualDockAssistActive = useCallback(
    (active) => {
      const nextActive = Boolean(active);
      const prevActive = Boolean(state.manualDockAssist?.active);
      if (prevActive === nextActive) return;
      dispatch({ type: 'control/set-manual-dock-assist', payload: nextActive });
      if (!nextActive) {
        pipeline.sendSong([{ note: 83, duration: 10 }, { note: 76, duration: 10 }], { slot: 0 });
        setServoAngle(0, { force: true });
        return;
      }
      const minAngle =
        typeof pipeline.servoConfig?.minAngle === 'number'
          ? pipeline.servoConfig.minAngle
          : -45;
      setServoAngle(minAngle, { force: true });
      pipeline.sendSong([{ note: 76, duration: 10 }, { note: 83, duration: 10 }], { slot: 0 });
      recordControlIntent();
    },
    [pipeline, recordControlIntent, setServoAngle, state.manualDockAssist?.active],
  );

  const toggleManualDockAssist = useCallback(() => {
    setManualDockAssistActive(!state.manualDockAssist?.active);
  }, [setManualDockAssistActive, state.manualDockAssist?.active]);

  const registerInputState = useCallback((source, data) => {
    dispatch({ type: 'control/register-input-state', payload: { source, state: data } });
  }, []);

  const setMicPttActive = useCallback((active) => {
    dispatch({ type: 'control/set-mic-ptt', payload: Boolean(active) });
  }, []);

  const actionImplementations = useMemo(
    () => ({
      setMode,
      setDriveVector,
      setAuxMotors,
      setServoAngle,
      nudgeServo,
      setCameraAxisIntent,
      goServoHome,
      setCameraPrecisionMode,
      runMacro,
      stopAllMotion,
      sendOiCommand,
      setSensorStream,
      setHeadlight,
      toggleHeadlight,
      setLaser,
      toggleLaser,
      updateKeyBinding,
      resetKeyBindings,
      registerInputState,
      setManualDockAssistActive,
      toggleManualDockAssist,
      setSongNote,
      sendSong,
      startHorn,
      stopHorn,
      setMicPttActive,
    }),
    [
      setMode,
      setDriveVector,
      setAuxMotors,
      setServoAngle,
      nudgeServo,
      setCameraAxisIntent,
      goServoHome,
      setCameraPrecisionMode,
      runMacro,
      stopAllMotion,
      sendOiCommand,
      setSensorStream,
      setHeadlight,
      toggleHeadlight,
      setLaser,
      toggleLaser,
      updateKeyBinding,
      resetKeyBindings,
      registerInputState,
      setManualDockAssistActive,
      toggleManualDockAssist,
      setSongNote,
      sendSong,
      startHorn,
      stopHorn,
      setMicPttActive,
    ],
  );

  const snapshot = useMemo(
    () => ({
      state,
      dispatch,
      pipeline,
      ptzControls,
      overcurrentLimiter,
      actions: stableActions,
    }),
    [state, pipeline, ptzControls, overcurrentLimiter, stableActions],
  );

  if (snapshotRef.current == null) {
    /*
      The first render has to make a snapshot available synchronously because
      descendants can call selector hooks during that same render pass. Later
      renders publish updates from the layout effect below, after React has
      committed the provider's new state.
    */
    snapshotRef.current = snapshot;
  }

  useLayoutEffect(() => {
    actionImplementationsRef.current = actionImplementations;
  }, [actionImplementations]);

  useLayoutEffect(() => {
    if (snapshotRef.current === snapshot) return;
    snapshotRef.current = snapshot;
    notifyControlSubscribers(snapshot);
  }, [notifyControlSubscribers, snapshot]);

  const store = useMemo(
    () => ({
      getSnapshot: getControlSnapshot,
      subscribe: subscribeControlSnapshot,
      actions: stableActions,
    }),
    [getControlSnapshot, stableActions, subscribeControlSnapshot],
  );

  return <ControlSystemContext.Provider value={store}>{children}</ControlSystemContext.Provider>;
}

export function useControlSelector(selector, equalityFn = Object.is) {
  const store = useContext(ControlSystemContext);
  if (!store) {
    throw new Error('useControlSelector must be used within ControlSystemProvider');
  }
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equalityFn);

  const [selected, setSelected] = useState(() => selector(store.getSnapshot()));

  useEffect(() => {
    /*
      Selector functions are often declared inline at the call site. Refreshing
      these refs from an effect keeps the subscription callback pointed at the
      newest selector/equality pair without making render mutate refs.
    */
    selectorRef.current = selector;
    equalityRef.current = equalityFn;
  }, [equalityFn, selector]);

  useEffect(() => {
    /*
      Recheck once after subscribing because the provider may have published a
      newer snapshot between this component's render and its effect. The equality
      guard keeps that synchronization from causing a redundant render.
    */
    setSelected((prev) => {
      const next = selectorRef.current(store.getSnapshot());
      return equalityRef.current(prev, next) ? prev : next;
    });

    return store.subscribe(
      (snapshot) => selectorRef.current(snapshot),
      (nextSelected) => {
        setSelected((prev) => (equalityRef.current(prev, nextSelected) ? prev : nextSelected));
      },
      (a, b) => equalityRef.current(a, b),
    );
  }, [store]);

  return selected;
}

export function useControlActions() {
  const store = useContext(ControlSystemContext);
  if (!store) {
    throw new Error('useControlActions must be used within ControlSystemProvider');
  }
  return store.actions;
}

export function useControlSystem() {
  /*
    This compatibility hook intentionally selects the whole snapshot, so it has
    the same broad update behavior as the old context API. New and migrated
    consumers should prefer useControlSelector/useControlActions so they only
    re-render for data they actually read.
  */
  return useControlSelector((snapshot) => snapshot);
}
