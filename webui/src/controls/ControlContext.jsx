import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { controlReducer, initialControlState } from './controlReducer.js';
import { computeDifferentialSpeeds, clamp } from './controlMath.js';
import { useCommandPipeline } from './commandPipeline.js';
import { DEFAULT_KEYMAP, DEFAULT_MACROS } from './constants.js';
import { canonicalizeKeyInput } from './keymapUtils.js';
import { useSettingsNamespace } from '../settings/index.js';

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
  const pipeline = useCommandPipeline();
  const [state, dispatch] = useReducer(controlReducer, initialControlState);
  const servoAngleRef = useRef(initialControlState.camera.angle);
  const {
    value: controlSettings,
    save: saveControlSettings,
  } = useSettingsNamespace('controls', { keymap: DEFAULT_KEYMAP, macros: DEFAULT_MACROS });

  useEffect(() => {
    dispatch({ type: 'control/set-rover', payload: pipeline.roverId });
  }, [pipeline.roverId]);

  useEffect(() => {
    if (controlSettings?.keymap) {
      dispatch({ type: 'control/set-keymap', payload: controlSettings.keymap });
    }
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
    dispatch({
      type: 'control/set-camera-config',
      payload: { config, angle: clamp(base, min, max) },
    });
    servoAngleRef.current = clamp(base, min, max);
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

  const setDriveVector = useCallback(
    (vector, meta = {}) => {
      const computed = computeDifferentialSpeeds(vector);
      dispatch({
        type: 'control/update-drive',
        payload: { ...computed, source: meta.source ?? null },
      });
      pipeline.sendDriveDirect(computed.speeds);
    },
    [pipeline],
  );

  const setAuxMotors = useCallback(
    (values = {}) => {
      const payload = pipeline.sendAuxMotors(values) ?? values;
      dispatch({
        type: 'control/set-aux-motors',
        payload,
      });
    },
    [pipeline],
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
    },
    [pipeline],
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
      await pipeline.runMacroSteps(macro);
    },
    [pipeline, state.macros],
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

  const registerInputState = useCallback((source, data) => {
    dispatch({ type: 'control/register-input-state', payload: { source, state: data } });
  }, []);

  const contextValue = useMemo(
    () => ({
      state,
      dispatch,
      pipeline,
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
        updateKeyBinding,
        resetKeyBindings,
        registerInputState,
      },
    }),
    [
      state,
      pipeline,
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
      updateKeyBinding,
      resetKeyBindings,
      registerInputState,
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
