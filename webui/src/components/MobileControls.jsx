import { useCallback, useEffect, useRef, useState } from 'react';
import { useControlSystem } from '../controls/index.js';
import { clampUnit } from '../controls/controlMath.js';
import DriveDockAction, { useDriveDockState } from './DriveDockAction.jsx';
import NightVisionControl from './NightVisionControl.jsx';
import HornControl from './HornControl.jsx';
import CameraTiltControl from './CameraTiltControl.jsx';

const SOURCE = 'mobile-joystick';
const JOYSTICK_RADIUS = 80;
const JOYSTICK_SMOOTHING = 0.15;
const AUX_ZERO = { main: 0, side: 0, vacuum: 0 };
const AUX_ALL_FORWARD = { main: 127, side: 127, vacuum: 127 };
const AUX_ALL_BACKWARD = { main: -127, side: -127, vacuum: -127 };

function FloatingJoystick({ disabled, layout, radius, onMove, onStop }) {
  const containerRef = useRef(null);
  const pointerIdRef = useRef(null);
  const baseRef = useRef({ x: 0, y: 0 });
  const [visual, setVisual] = useState({ active: false, base: { x: 0, y: 0 }, knob: { x: 0, y: 0 } });

  const stopTracking = useCallback(() => {
    pointerIdRef.current = null;
    setVisual({ active: false, base: { x: 0, y: 0 }, knob: { x: 0, y: 0 } });
    onStop?.();
  }, [onStop]);

  const handlePointerDown = useCallback(
    (event) => {
      if (disabled) return;
      if (pointerIdRef.current !== null) return;
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      baseRef.current = { x, y };
      pointerIdRef.current = event.pointerId;
      container.setPointerCapture?.(event.pointerId);
      setVisual({ active: true, base: { x, y }, knob: { x: 0, y: 0 } });
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (disabled || pointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const currentX = event.clientX - rect.left;
      const currentY = event.clientY - rect.top;
      const dx = currentX - baseRef.current.x;
      const dy = currentY - baseRef.current.y;
      const distance = Math.min(Math.hypot(dx, dy), radius);
      const angle = Math.atan2(dy, dx);
      const knobX = Math.cos(angle) * distance;
      const knobY = Math.sin(angle) * distance;
      const vector = {
        x: clampUnit(knobX / radius),
        y: clampUnit(-knobY / radius),
        boost: false,
      };
      setVisual((prev) => ({ ...prev, knob: { x: knobX, y: knobY } }));
      onMove?.(vector);
    },
    [disabled, onMove],
  );

  const handlePointerEnd = useCallback(
    (event) => {
      if (pointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      const container = containerRef.current;
      container?.releasePointerCapture?.(event.pointerId);
      stopTracking();
    },
    [stopTracking],
  );

  useEffect(() => {
    if (disabled) {
      stopTracking();
    }
  }, [disabled, stopTracking]);

  const heightClass = layout === 'landscape' ? 'h-[260px]' : 'h-[220px]';

  return (
    <div
      ref={containerRef}
      role="presentation"
      className={`relative w-full ${heightClass} select-none overflow-hidden bg-zinc-950`}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onContextMenu={(event) => event.preventDefault()}
    >
      {!visual.active && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-xs text-slate-400">
          <p>Touch and hold anywhere</p>
          <p>Joystick will follow your thumb</p>
        </div>
      )}
      {visual.active && (
        <>
          <div
            className="pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 bg-cyan-400/10 outline outline-2 outline-cyan-400/60 [clip-path:circle(50%)]"
            style={{ left: visual.base.x, top: visual.base.y }}
          />
          <div
            className="pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 bg-cyan-300/80 shadow-lg [clip-path:circle(50%)]"
            style={{
              left: visual.base.x + visual.knob.x,
              top: visual.base.y + visual.knob.y,
            }}
          />
        </>
      )}
    </div>
  );
}

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
    if (disabled) {
      smoothedVectorRef.current = { x: 0, y: 0, boost: false };
    }
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
        <>
          <FloatingJoystick
            disabled={disabled}
            layout={layout}
            radius={joystickRadius}
            onMove={handleMove}
            onStop={handleStop}
          />
        </>
      ) : null}
      {/* Panic stop button can be re-enabled here if needed */}

    </div>
  );
}

function MobileAuxButton({ id, label, values, color, disabled, onPress, onRelease }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        onPress(id, values);
      }}
      onPointerUp={() => onRelease(id)}
      onPointerLeave={() => onRelease(id)}
      onPointerCancel={() => onRelease(id)}
      onContextMenu={(event) => event.preventDefault()}
      className={`flex h-full w-full items-center justify-center rounded-xl border-2 px-1 py-0.75 text-center text-sm font-semibold text-white transition select-none no-touch-select ${color} hover:brightness-110 active:brightness-125 active:scale-[0.99] disabled:opacity-30`}
    >
      {label}
    </button>
  );
}

function MobileLeftColumnContent({ layout }) {
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

export function MobileLeftColumn({ layout, className = '' }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
      <MobileLeftColumnContent layout={layout} />
    </div>
  );
}

export function MobileRightColumn({ layout, className = '' }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
      <MobileJoystickPanel layout={layout === 'landscape' ? 'landscape' : 'portrait'} />
    </div>
  );
}

export default function MobilePortraitControls() {
  const columnHeight = 'h-[min(60svh,24rem)]';
  return (
    <section className="panel">
      <div className="grid grid-cols-2 gap-0.5 items-stretch">
        <MobileLeftColumn layout="portrait" className={columnHeight} />
        <MobileRightColumn layout="portrait" className={columnHeight} />
      </div>
    </section>
  );
}
