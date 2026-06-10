// Mobile Controls Content
// Purpose: Defines the Mobile Controls Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useControlSystem } from '../../controls/index.js';
import { normalizeKeymapEntries } from '../../controls/keymapUtils.js';
import {
  computeKeyboardDriveVector,
  getKeyboardDriveSpeedOptions,
  resolveKeyboardSpeeds,
} from '../../controls/inputs/driveIntent.js';
import DriveDockAction, { useDriveDockState } from '../DriveDockAction/index.jsx';
import NightVisionControl from '../NightVisionControl/index.jsx';
import HornControl from '../HornControl/index.jsx';
import CameraTiltControl from '../CameraTiltControl/index.jsx';
import FloatingJoystick from './FloatingJoystick.jsx';
import MobileAuxButton from './MobileAuxButton.jsx';
import {
  SOURCE,
  DRIVE_PAD_REPEAT_MS,
  DRIVE_PAD_SPEED_MODES,
  AUX_ZERO,
  AUX_ALL_FORWARD,
  AUX_ALL_BACKWARD,
} from './constants.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';

function firstTokenForAction(keymap, actionId) {
  const bindingSet = keymap?.[actionId];
  if (!bindingSet || bindingSet.size === 0) return null;
  return bindingSet.values().next().value ?? null;
}

function getSpeedModeConfig(speedMode) {
  return DRIVE_PAD_SPEED_MODES.find((mode) => mode.id === speedMode) || DRIVE_PAD_SPEED_MODES[1];
}

function MobileJoystickPanel({ layout }) {
  const {
    state: { roverId, keymap: rawKeymap },
    actions: { setDriveVector, registerInputState },
  } = useControlSystem();
  const { value: inputSettings } = useSettingsNamespace('inputs', INPUT_SETTINGS_DEFAULTS);
  const driveDockState = useDriveDockState(roverId);
  const dockedNotDriving = driveDockState.docked && !driveDockState.driving;
  const expandAction = dockedNotDriving || driveDockState.dockingInProgress;
  const disabled = !roverId;
  const [speedMode, setSpeedMode] = useState('normal');
  const speedModeRef = useRef('normal');
  const activeCellRef = useRef(null);
  const repeatTimerRef = useRef(null);
  const keymap = useMemo(() => normalizeKeymapEntries(rawKeymap), [rawKeymap]);
  const keyboardSpeeds = useMemo(() => resolveKeyboardSpeeds(inputSettings), [inputSettings]);

  const clearRepeatTimer = useCallback(() => {
    if (!repeatTimerRef.current) return;
    clearInterval(repeatTimerRef.current);
    repeatTimerRef.current = null;
  }, []);

  const buildVirtualKeyTokens = useCallback(
    (cell, modeId = speedModeRef.current) => {
      const tokens = new Set();
      const speedModeConfig = getSpeedModeConfig(modeId);
      const actionIds = [
        ...(Array.isArray(cell?.actions) ? cell.actions : []),
        speedModeConfig.modifierAction,
      ].filter(Boolean);

      actionIds.forEach((actionId) => {
        const token = firstTokenForAction(keymap, actionId);
        if (token) tokens.add(token);
      });

      return tokens;
    },
    [keymap],
  );

  const sendDriveCell = useCallback(
    (cell, lastEvent = 'move', modeId = speedModeRef.current) => {
      if (disabled) return;
      const tokens = buildVirtualKeyTokens(cell, modeId);
      const vector = computeKeyboardDriveVector(tokens, keymap);
      const speedOptions = getKeyboardDriveSpeedOptions(tokens, keymap, keyboardSpeeds);

      // Mobile deliberately routes through the keyboard vector/speed helpers. The
      // thumb pad only chooses which virtual keys are down, so changes to keyboard
      // drive behavior automatically stay matched here.
      setDriveVector(vector, { source: SOURCE, speedOptions });
      registerInputState(SOURCE, {
        keys: Array.from(tokens),
        vector,
        activeCell: cell?.id ?? 'stop',
        speedMode: modeId,
        lastEvent,
      });
    },
    [
      buildVirtualKeyTokens,
      disabled,
      keyboardSpeeds,
      keymap,
      registerInputState,
      setDriveVector,
    ],
  );

  const stopDrivePad = useCallback(
    (lastEvent = 'stop') => {
      clearRepeatTimer();
      activeCellRef.current = null;
      sendDriveCell({ id: 'stop', actions: [] }, lastEvent, 'normal');
    },
    [clearRepeatTimer, sendDriveCell],
  );

  const startRepeatTimer = useCallback(() => {
    if (repeatTimerRef.current) return;
    repeatTimerRef.current = setInterval(() => {
      if (!activeCellRef.current) return;
      sendDriveCell(activeCellRef.current, 'repeat');
    }, DRIVE_PAD_REPEAT_MS);
  }, [sendDriveCell]);

  const handleCellChange = useCallback(
    (cell) => {
      if (disabled) return;
      activeCellRef.current = cell;
      sendDriveCell(cell, 'move');
      startRepeatTimer();
    },
    [disabled, sendDriveCell, startRepeatTimer],
  );

  const handleSpeedModeChange = useCallback(
    (nextMode) => {
      setSpeedMode(nextMode);
      speedModeRef.current = nextMode;
      if (activeCellRef.current) {
        sendDriveCell(activeCellRef.current, 'speed', nextMode);
      }
    },
    [sendDriveCell],
  );

  useEffect(() => {
    return () => clearRepeatTimer();
  }, [clearRepeatTimer]);

  useEffect(() => {
    if (!disabled) return;
    stopDrivePad('disabled');
  }, [disabled, stopDrivePad]);

  const fillClass = dockedNotDriving ? 'max-h-screen self-start' : '';
  const containerClass = `flex h-full flex-col gap-0.5 text-slate-100 ${fillClass}`;

  return (
    <div className={containerClass} data-mobile-layout={layout}>
      <DriveDockAction
        layout="mobile"
        expand={expandAction}
        driveDockState={driveDockState}
        compactHeightClass="min-h-[5rem]"
      />
      {!expandAction ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border-2 border-slate-700 bg-slate-900/70 text-slate-100 shadow-md">
          <div className="grid grid-cols-3 gap-0.5 border-b border-slate-700 bg-slate-950/80 p-0.5">
            {DRIVE_PAD_SPEED_MODES.map((mode) => {
              const active = speedMode === mode.id;
              const speedValue =
                mode.id === 'precision'
                  ? keyboardSpeeds.precisionSpeed
                  : mode.id === 'turbo'
                  ? keyboardSpeeds.turboSpeed
                  : keyboardSpeeds.baseSpeed;
              return (
                <button
                  key={mode.id}
                  type="button"
                  className={`min-h-9 rounded-md px-1 text-xs font-semibold ${
                    active
                      ? 'bg-cyan-300 text-slate-950'
                      : 'bg-slate-800 text-slate-200'
                  }`}
                  onClick={() => handleSpeedModeChange(mode.id)}
                  disabled={disabled}
                >
                  <span className="block leading-tight">{mode.label}</span>
                  <span className="block font-mono text-[0.7rem] leading-tight">{speedValue}</span>
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1">
            <FloatingJoystick
              disabled={disabled}
              onCellChange={handleCellChange}
              onStop={() => stopDrivePad('stop')}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MobileActionsColumnContent() {
  const {
    state: { roverId, camera, horn },
    pipeline,
    actions: { setServoAngle, setNightVision, setAuxMotors, startHorn, stopHorn },
  } = useControlSystem();
  const dockAssist = useManualDockAssist();
  const disabled = !roverId;
  const activeRef = useRef(null);
  const cameraConfig = camera?.config;
  const cameraEnabled = Boolean(roverId && camera?.enabled && cameraConfig);
  const nightVisionAvailable = Boolean(roverId && pipeline?.nightVision);
  const nightVisionState = pipeline?.nightVisionState;
  const hornAvailable = Boolean(roverId && pipeline?.horn);
  const hornBlocked = horn?.overheated;
  const cameraMin = typeof cameraConfig?.minAngle === 'number' ? cameraConfig.minAngle : -45;
  const cameraMax = typeof cameraConfig?.maxAngle === 'number' ? cameraConfig.maxAngle : 45;
  const cameraValue =
    typeof camera?.angle === 'number'
      ? camera.angle
      : typeof cameraConfig?.homeAngle === 'number'
      ? cameraConfig.homeAngle
      : (cameraMin + cameraMax) / 2;
  const cameraDisabled = Boolean(disabled || dockAssist.cameraLocked);

  const handleNightVisionToggle = useCallback(
    (nextOn) => {
      if (!nightVisionAvailable) return;
      setNightVision(nextOn);
    },
    [nightVisionAvailable, setNightVision],
  );

  const handleAuxPress = useCallback(
    (id, values) => {
      if (disabled) return;
      activeRef.current = id;
      setAuxMotors(values);
    },
    [disabled, setAuxMotors],
  );

  const handleAuxRelease = useCallback(
    (id) => {
      if (disabled) return;
      if (activeRef.current === id) {
        activeRef.current = null;
        setAuxMotors(AUX_ZERO);
      }
    },
    [disabled, setAuxMotors],
  );

  return (
    <div className="grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-0.5 text-slate-100">
      <div className="grid min-h-0 grid-rows-2 gap-0.5">
        <MobileAuxButton
          id="aux-vac-forward"
          label="Vacuum Forward"
          values={AUX_ALL_FORWARD}
          color="bg-fuchsia-600"
          disabled={disabled}
          onPress={handleAuxPress}
          onRelease={handleAuxRelease}
        />
        <MobileAuxButton
          id="aux-vac-backward"
          label="Vacuum Backward"
          values={AUX_ALL_BACKWARD}
          color="bg-fuchsia-800"
          disabled={disabled}
          onPress={handleAuxPress}
          onRelease={handleAuxRelease}
        />
      </div>
      <div className="flex min-h-0 items-stretch gap-0.5">
        {cameraEnabled ? (
          <div className="flex-1 min-h-0 rounded bg-zinc-950 p-0.25">
            <CameraTiltControl
              value={cameraValue}
              min={cameraMin}
              max={cameraMax}
              step={0.5}
              disabled={cameraDisabled}
              onChange={setServoAngle}
              orientation="vertical"
              label="Camera Tilt"
              labelClass="text-sm font-semibold text-white [writing-mode:vertical-rl] rotate-180"
              labelRowClass="text-[0.7rem] text-slate-300"
              valueClass="font-mono text-slate-200"
              className="h-full gap-0"
              sliderClass="h-full w-7"
              accentClass="accent-cyan-400"
              showEndpoints={false}
              showValue={false}
            />
          </div>
        ) : null}
        {nightVisionAvailable ? (
          <NightVisionControl
            nightVisionOn={nightVisionState?.nightVisionOn}
            disabled={disabled}
            onToggle={handleNightVisionToggle}
            heightClass="h-full"
          />
        ) : null}
      </div>
      <div className="min-h-0">
        {hornAvailable ? (
          <HornControl
            disabled={disabled || hornBlocked}
            onStart={startHorn}
            onStop={stopHorn}
            active={horn?.active}
            heat={horn?.heat}
            defaultShowSettings={false}
            showSettingsToggle
            compactSettings
            className="h-full"
          />
        ) : null}
      </div>
    </div>
  );
}

export function MobileActionsColumn({ layout, className = '' }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`.trim()} data-mobile-layout={layout}>
      <MobileActionsColumnContent />
    </div>
  );
}

export function MobileDriveColumn({ layout, className = '' }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`.trim()} data-mobile-layout={layout}>
      <MobileJoystickPanel layout={layout === 'landscape' ? 'landscape' : 'portrait'} />
    </div>
  );
}

export default function MobilePortraitControls({ swapColumns = false }) {
  const columnHeight = 'h-[min(60svh,24rem)]';
  const firstColumn = swapColumns
    ? <MobileDriveColumn layout="portrait" className={columnHeight} />
    : <MobileActionsColumn layout="portrait" className={columnHeight} />;
  const secondColumn = swapColumns
    ? <MobileActionsColumn layout="portrait" className={columnHeight} />
    : <MobileDriveColumn layout="portrait" className={columnHeight} />;
  return (
    <section className="panel">
      <div className="grid grid-cols-2 gap-0.5 items-stretch">
        {firstColumn}
        {secondColumn}
      </div>
    </section>
  );
}
