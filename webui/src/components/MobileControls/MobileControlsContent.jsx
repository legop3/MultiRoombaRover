// Mobile Controls Content
// Purpose: Defines the Mobile Controls Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useRef } from 'react';
import { useControlSystem } from '../../controls/index.js';
import { clampUnit } from '../../controls/controlMath.js';
import DriveDockAction, { useDriveDockState } from '../DriveDockAction/index.jsx';
import NightVisionControl from '../NightVisionControl/index.jsx';
import HornControl from '../HornControl/index.jsx';
import CameraTiltControl from '../CameraTiltControl/index.jsx';
import FloatingJoystick from './FloatingJoystick.jsx';
import MobileAuxButton from './MobileAuxButton.jsx';
import {
  SOURCE,
  JOYSTICK_RADIUS,
  JOYSTICK_SMOOTHING,
  AUX_ZERO,
  AUX_ALL_FORWARD,
  AUX_ALL_BACKWARD,
} from './constants.js';

function MobileJoystickPanel({ layout }) {
  const {
    state: { roverId },
    actions: { setDriveVector, registerInputState },
  } = useControlSystem();
  const driveDockState = useDriveDockState(roverId);
  const dockedNotDriving = driveDockState.docked && !driveDockState.driving;
  const expandAction = dockedNotDriving || driveDockState.dockingInProgress;
  const disabled = !roverId;
  const joystickRadius = JOYSTICK_RADIUS;
  const smoothing = JOYSTICK_SMOOTHING;
  const smoothedVectorRef = useRef({ x: 0, y: 0, boost: false });

  useEffect(() => {
    if (disabled) smoothedVectorRef.current = { x: 0, y: 0, boost: false };
  }, [disabled]);

  const handleMove = useCallback(
    (vector = {}) => {
      if (disabled) return;
      const next = {
        x: clampUnit(vector.x ?? 0),
        y: clampUnit(vector.y ?? 0),
        boost: Boolean(vector.boost),
      };
      const applied =
        smoothing > 0
          ? {
              x: smoothedVectorRef.current.x + (next.x - smoothedVectorRef.current.x) * (1 - smoothing),
              y: smoothedVectorRef.current.y + (next.y - smoothedVectorRef.current.y) * (1 - smoothing),
              boost: next.boost,
            }
          : next;
      smoothedVectorRef.current = applied;
      setDriveVector(applied, { source: SOURCE });
      registerInputState(SOURCE, { vector: applied, lastEvent: 'move' });
    },
    [disabled, registerInputState, setDriveVector, smoothing],
  );

  const handleStop = useCallback(() => {
    if (disabled) return;
    const zero = { x: 0, y: 0, boost: false };
    smoothedVectorRef.current = zero;
    setDriveVector(zero, { source: SOURCE });
    registerInputState(SOURCE, { vector: zero, lastEvent: 'stop' });
  }, [disabled, registerInputState, setDriveVector]);

  const fillClass = dockedNotDriving ? 'max-h-screen self-start' : '';
  const containerClass = `flex h-full flex-col gap-0.5 text-slate-100 ${fillClass}`;

  return (
    <div className={containerClass}>
      <DriveDockAction
        layout="mobile"
        expand={expandAction}
        driveDockState={driveDockState}
        compactHeightClass="min-h-[5rem]"
      />
      {!expandAction ? (
        <div className="flex-1 min-h-0">
          <FloatingJoystick
            disabled={disabled}
            layout={layout}
            radius={joystickRadius}
            onMove={handleMove}
            onStop={handleStop}
          />
        </div>
      ) : null}
    </div>
  );
}

function MobileActionsColumnContent({ layout }) {
  const {
    state: { roverId, camera, horn },
    pipeline,
    actions: { setServoAngle, setNightVision, setAuxMotors, startHorn, stopHorn },
  } = useControlSystem();
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
    <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
      <MobileActionsColumnContent layout={layout} />
    </div>
  );
}

export function MobileDriveColumn({ layout, className = '' }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
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
