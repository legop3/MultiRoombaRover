import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { controlReducer, initialControlState } from './controlReducer.js';
import { computeDifferentialSpeeds, clamp } from './controlMath.js';
import { useCommandPipeline } from './commandPipeline.js';
import { DEFAULT_KEYMAP, DEFAULT_MACROS, SONG_DEFAULT_NOTE } from './constants.js';
import { canonicalizeKeyInput } from './keymapUtils.js';
import { useSettingsNamespace } from '../settings/index.js';
import { useSession } from '../context/SessionContext.jsx';
import { HORN_SETTINGS_DEFAULTS } from '../settings/namespaces.js';
import {
  applyAuxOvercurrentScale,
  applyDriveOvercurrentScale,
  useOvercurrentLimiter,
} from './overcurrentLimiter.js';

const ControlSystemContext = createContext(null);

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

export function ControlSystemProvider({ children }) {
  const [state, dispatch] = useReducer(controlReducer, initialControlState);
  const prevModeRef = useRef(null);
  const pendingLightsRef = useRef(false);
  const servoAngleRef = useRef(initialControlState.camera.angle);
  const {
    value: controlSettings,
    save: saveControlSettings,
  } = useSettingsNamespace('controls', { keymap: DEFAULT_KEYMAP, macros: DEFAULT_MACROS });
  const { value: hornSettings } = useSettingsNamespace('horn', HORN_SETTINGS_DEFAULTS);
  const { session, homeAssistantSetState } = useSession();
  const roverId = session?.assignment?.roverId ?? null;
  const overcurrentLimiter = useOvercurrentLimiter(roverId);
  const driveTransform = useCallback(
    (speeds) => applyDriveOvercurrentScale(speeds, overcurrentLimiter.scales, overcurrentLimiter.adminImmune),
    [overcurrentLimiter.adminImmune, overcurrentLimiter.scales],
  );
  const auxTransform = useCallback(
    (values) => applyAuxOvercurrentScale(values, overcurrentLimiter.scales, overcurrentLimiter.adminImmune),
    [overcurrentLimiter.adminImmune, overcurrentLimiter.scales],
  );
  const pipeline = useCommandPipeline({ driveTransform, auxTransform });

  const turnOnAllLights = useCallback(() => {
    const entities = session?.homeAssistant?.entities || [];
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
  }, [session?.homeAssistant?.entities, homeAssistantSetState]);

  useEffect(() => {
    dispatch({ type: 'control/set-rover', payload: pipeline.roverId });
  }, [pipeline.roverId]);

  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = state.mode;
    if (prevMode !== 'drive' && state.mode === 'drive' && session?.homeAssistant?.entities) {
      turnOnAllLights();
    } else if (prevMode !== 'drive' && state.mode === 'drive') {
      pendingLightsRef.current = true;
    }
  }, [state.mode, session?.homeAssistant?.entities, turnOnAllLights]);

  useEffect(() => {
    if (pendingLightsRef.current && session?.homeAssistant?.entities) {
      turnOnAllLights();
    }
  }, [session?.homeAssistant?.entities, turnOnAllLights]);

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

  const driveSpeedsRef = useRef(state.drive.speeds);
  const auxValuesRef = useRef(state.aux);
  const limiterScaleToken = useMemo(() => JSON.stringify(overcurrentLimiter.scales), [overcurrentLimiter.scales]);
  const limiterDriveSentAtRef = useRef(0);
  const limiterAuxSentAtRef = useRef(0);

  useEffect(() => {
    driveSpeedsRef.current = state.drive.speeds;
  }, [state.drive.speeds]);

  useEffect(() => {
    auxValuesRef.current = state.aux;
  }, [state.aux]);

  useEffect(() => {
    if (!pipeline.roverId || overcurrentLimiter.adminImmune || !overcurrentLimiter.isActive) return;
    const outputRateMs = Math.max(0, Number(overcurrentLimiter?.config?.outputRateMs) || 0);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const drive = driveSpeedsRef.current || { left: 0, right: 0 };
    const aux = auxValuesRef.current || { main: 0, side: 0, vacuum: 0 };
    const driveActive = Boolean(drive.left || drive.right);
    const auxActive = Boolean(aux.main || aux.side || aux.vacuum);
    if (!driveActive && !auxActive) return;
    if (driveActive && now - limiterDriveSentAtRef.current >= outputRateMs) {
      limiterDriveSentAtRef.current = now;
      pipeline.sendDriveDirect(drive);
    }
    if (auxActive && now - limiterAuxSentAtRef.current >= outputRateMs) {
      limiterAuxSentAtRef.current = now;
      pipeline.sendAuxMotors(aux);
    }
  }, [limiterScaleToken, overcurrentLimiter.adminImmune, overcurrentLimiter.config, overcurrentLimiter.isActive, pipeline]);

  const setDriveVector = useCallback(
    (vector, meta = {}) => {
      const computed = computeDifferentialSpeeds(vector, meta.speedOptions);
      dispatch({
        type: 'control/update-drive',
        payload: { ...computed, source: meta.source ?? null },
      });
      recordControlIntent();
      pipeline.sendDriveDirect(computed.speeds);
    },
    [pipeline, recordControlIntent],
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
    (value) => {
      if (!pipeline.servoConfig) return;
      const clamped = clampServoAngle(pipeline.servoConfig, value);
      dispatch({ type: 'control/set-camera-angle', payload: clamped });
      pipeline.sendServoAngle(clamped);
      servoAngleRef.current = clamped;
      recordControlIntent();
    },
    [pipeline, recordControlIntent],
  );

  const nudgeServo = useCallback(
    (delta = 0) => {
      const config = pipeline.servoConfig;
      if (!config) return;
      const step = typeof delta === 'number' && delta !== 0 ? delta : config.nudgeDegrees || 1;
      const baseline =
        typeof servoAngleRef.current === 'number'
          ? servoAngleRef.current
          : typeof config.homeAngle === 'number'
          ? config.homeAngle
          : 0;
      setServoAngle(baseline + step);
    },
    [pipeline.servoConfig, setServoAngle],
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

  const runMacro = useCallback(
    async (macroId) => {
      const macro = state.macros.find((item) => item.id === macroId) || null;
      if (!macro) return;
      if (macroId === 'drive-sequence') {
        turnOnAllLights();
        if (!session?.homeAssistant?.entities) {
          pendingLightsRef.current = true;
        }
        recordControlIntent();
      } else if (macroId === 'seek-dock') {
        recordControlIntent();
      }
      await pipeline.runMacroSteps(macro);
    },
    [pipeline, recordControlIntent, session?.homeAssistant?.entities, state.macros, turnOnAllLights],
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
    pipeline.sendDriveDirect({ left: 0, right: 0 });
    pipeline.sendAuxMotors({ main: 0, side: 0, vacuum: 0 });
  }, [pipeline]);

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

  const setNightVision = useCallback(
    (nightVisionOn) => {
      if (!pipeline.nightVision) return;
      if (typeof nightVisionOn === 'boolean') {
        const action = nightVisionOn ? 'off' : 'on';
        pipeline.sendNightVision(action);
      } else {
        pipeline.sendNightVision('toggle');
      }
      recordControlIntent();
    },
    [pipeline, recordControlIntent],
  );

  const toggleNightVision = useCallback(() => {
    setNightVision();
  }, [setNightVision]);

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
        return num <= 0 ? 0 : Math.min(5000, Math.round(num));
      });
    return { waveform, freqs: normalized };
  }, [hornSettings]);

  const startHorn = useCallback(() => {
    if (!pipeline.horn) return;
    pipeline.sendHorn({ action: 'start', ...normalizedHornSettings });
    dispatch({ type: 'control/set-horn-active', payload: true });
    recordControlIntent();
  }, [dispatch, normalizedHornSettings, pipeline, recordControlIntent]);

  const stopHorn = useCallback(() => {
    if (!pipeline.horn) return;
    pipeline.sendHorn({ action: 'stop' });
    dispatch({ type: 'control/set-horn-active', payload: false });
  }, [dispatch, pipeline]);

  const registerInputState = useCallback((source, data) => {
    dispatch({ type: 'control/register-input-state', payload: { source, state: data } });
  }, []);

  const contextValue = useMemo(
    () => ({
      state,
      dispatch,
      pipeline,
      overcurrentLimiter,
      actions: {
        setMode,
        setDriveVector,
        setAuxMotors,
        setServoAngle,
        nudgeServo,
        goServoHome,
        runMacro,
        stopAllMotion,
        sendOiCommand,
        setSensorStream,
        setNightVision,
        toggleNightVision,
        updateKeyBinding,
        resetKeyBindings,
        registerInputState,
        setSongNote,
        sendSong,
        startHorn,
        stopHorn,
      },
    }),
    [
      state,
      pipeline,
      overcurrentLimiter,
      setMode,
      setDriveVector,
      setAuxMotors,
      setServoAngle,
      nudgeServo,
      goServoHome,
      runMacro,
      stopAllMotion,
      sendOiCommand,
      setSensorStream,
      setNightVision,
      toggleNightVision,
      updateKeyBinding,
      resetKeyBindings,
      registerInputState,
      setSongNote,
      sendSong,
      startHorn,
      stopHorn,
    ],
  );

  return <ControlSystemContext.Provider value={contextValue}>{children}</ControlSystemContext.Provider>;
}

export function useControlSystem() {
  const context = useContext(ControlSystemContext);
  if (!context) {
    throw new Error('useControlSystem must be used within ControlSystemProvider');
  }
  return context;
}
