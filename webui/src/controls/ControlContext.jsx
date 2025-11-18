import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import { controlReducer, initialControlState } from './controlReducer.js';
import { computeDifferentialSpeeds, clamp } from './controlMath.js';
import { useCommandPipeline } from './commandPipeline.js';
import { loadControlSettings, saveControlSettings } from './persistence.js';

const ControlSystemContext = createContext(null);

function clampServoAngle(config, value) {
  if (!config) return value;
  const min = typeof config.minAngle === 'number' ? config.minAngle : -45;
  const max = typeof config.maxAngle === 'number' ? config.maxAngle : 45;
  return clamp(value, min, max);
}

export function ControlSystemProvider({ children }) {
  const pipeline = useCommandPipeline();
  const [state, dispatch] = useReducer(controlReducer, initialControlState);

  useEffect(() => {
    dispatch({ type: 'control/set-rover', payload: pipeline.roverId });
  }, [pipeline.roverId]);

  useEffect(() => {
    dispatch({ type: 'control/settings/loading' });
    const data = loadControlSettings();
    dispatch({ type: 'control/settings/loaded', payload: data });
  }, []);

  useEffect(() => {
    const config = pipeline.servoConfig;
    if (!config) {
      dispatch({ type: 'control/set-camera-config', payload: { config: null } });
      return;
    }
    const min = typeof config.minAngle === 'number' ? config.minAngle : -45;
    const max = typeof config.maxAngle === 'number' ? config.maxAngle : 45;
    const base = typeof config.homeAngle === 'number' ? config.homeAngle : (min + max) / 2;
    dispatch({
      type: 'control/set-camera-config',
      payload: { config, angle: clamp(base, min, max) },
    });
  }, [pipeline.servoConfig]);

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

  const setServoAngle = useCallback(
    (value) => {
      if (!pipeline.servoConfig) return;
      const clamped = clampServoAngle(pipeline.servoConfig, value);
      dispatch({ type: 'control/set-camera-angle', payload: clamped });
      pipeline.sendServoAngle(clamped);
    },
    [pipeline],
  );

  const nudgeServo = useCallback(
    (delta = 0) => {
      const config = pipeline.servoConfig;
      if (!config) return;
      const step = typeof delta === 'number' && delta !== 0 ? delta : config.nudgeDegrees || 1;
      const baseline =
        typeof state.camera.angle === 'number'
          ? state.camera.angle
          : typeof config.homeAngle === 'number'
          ? config.homeAngle
          : 0;
      setServoAngle(baseline + step);
    },
    [pipeline.servoConfig, setServoAngle, state.camera.angle],
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

  const reloadSettings = useCallback(() => {
    dispatch({ type: 'control/settings/loading' });
    const next = loadControlSettings();
    dispatch({ type: 'control/settings/loaded', payload: next });
  }, []);

  const persistSettings = useCallback(
    (partial) => {
      const merged = { ...(state.settings.data ?? {}), ...(partial ?? {}) };
      const success = saveControlSettings(merged);
      if (success) {
        dispatch({ type: 'control/settings/loaded', payload: merged });
      } else {
        dispatch({
          type: 'control/settings/error',
          payload: new Error('Failed to save control settings'),
        });
      }
      return success;
    },
    [state.settings.data],
  );

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
        registerInputState,
        reloadSettings,
        persistSettings,
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
      registerInputState,
      reloadSettings,
      persistSettings,
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
