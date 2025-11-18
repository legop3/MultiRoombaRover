import { useCallback, useEffect, useRef, useState } from 'react';
import { useControlSystem } from '../controls/index.js';
import { clampUnit } from '../controls/controlMath.js';
import DriveModeToggle from './controls/DriveModeToggle.jsx';

const SOURCE = 'mobile-joystick';
const JOYSTICK_RADIUS = 80;
const AUX_BUTTONS = [
  { id: 'main-forward', label: 'Main +', values: { main: 127 }, hold: true, color: 'bg-emerald-600' },
  { id: 'main-reverse', label: 'Main -', values: { main: -127 }, hold: true, color: 'bg-emerald-800' },
  { id: 'side-forward', label: 'Side +', values: { side: 127 }, hold: true, color: 'bg-cyan-600' },
  { id: 'side-reverse', label: 'Side -', values: { side: -70 }, hold: true, color: 'bg-cyan-800' },
  { id: 'vacuum-fast', label: 'Vacuum Max', values: { vacuum: 127 }, hold: true, color: 'bg-amber-500 text-amber-950' },
  { id: 'vacuum-slow', label: 'Vacuum Low', values: { vacuum: 50 }, hold: true, color: 'bg-amber-700' },
  { id: 'all-forward', label: 'All +', values: { main: 127, side: 127, vacuum: 127 }, hold: true, color: 'bg-fuchsia-600' },
  { id: 'stop-all', label: 'Stop', values: { main: 0, side: 0, vacuum: 0 }, hold: false, color: 'bg-slate-900' },
];

function FloatingJoystick({ disabled, layout, onMove, onStop }) {
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
      const distance = Math.min(Math.hypot(dx, dy), JOYSTICK_RADIUS);
      const angle = Math.atan2(dy, dx);
      const knobX = Math.cos(angle) * distance;
      const knobY = Math.sin(angle) * distance;
      const vector = {
        x: clampUnit(knobX / JOYSTICK_RADIUS),
        y: clampUnit(-knobY / JOYSTICK_RADIUS),
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
      className={`relative w-full ${heightClass} select-none overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70`}
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
            className="pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-400/60 bg-cyan-400/10"
            style={{ left: visual.base.x, top: visual.base.y }}
          />
          <div
            className="pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/80 shadow-lg"
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
    actions: { setDriveVector, registerInputState, stopAllMotion },
  } = useControlSystem();
  const disabled = !roverId;

  const handleMove = useCallback(
    (vector = {}) => {
      if (disabled) return;
      const next = {
        x: clampUnit(vector.x ?? 0),
        y: clampUnit(vector.y ?? 0),
        boost: Boolean(vector.boost),
      };
      setDriveVector(next, { source: SOURCE });
      registerInputState(SOURCE, { vector: next, lastEvent: 'move' });
    },
    [disabled, registerInputState, setDriveVector],
  );

  const handleStop = useCallback(() => {
    if (disabled) return;
    const zero = { x: 0, y: 0, boost: false };
    setDriveVector(zero, { source: SOURCE });
    registerInputState(SOURCE, { vector: zero, lastEvent: 'stop' });
  }, [disabled, registerInputState, setDriveVector]);

  return (
    <div className="flex flex-col gap-1 text-slate-100">
      <DriveModeToggle size="compact" />
      <FloatingJoystick disabled={disabled} layout={layout} onMove={handleMove} onStop={handleStop} />
      <button
        type="button"
        onClick={stopAllMotion}
        disabled={disabled}
        className="rounded bg-red-600 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-red-100 disabled:opacity-40"
      >
        Panic Stop
      </button>
    </div>
  );
}

function AuxMotorPanel({ orientation }) {
  const {
    state: { roverId },
    actions: { setAuxMotors },
  } = useControlSystem();
  const activeRef = useRef(null);
  const disabled = !roverId;

  const handlePress = useCallback(
    (button) => {
      if (disabled) return;
      if (button.hold === false) {
        setAuxMotors(button.values);
        activeRef.current = null;
        return;
      }
      activeRef.current = button.id;
      setAuxMotors(button.values);
    },
    [disabled, setAuxMotors],
  );

  const handleRelease = useCallback(
    (button) => {
      if (disabled || button.hold === false) return;
      if (activeRef.current === button.id) {
        activeRef.current = null;
        setAuxMotors({ main: 0, side: 0, vacuum: 0 });
      }
    },
    [disabled, setAuxMotors],
  );

  const gridCols = orientation === 'landscape' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2';

  return (
    <div className="flex flex-col gap-1 text-slate-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Aux controls</p>
      <div className={`grid ${gridCols} gap-1`}>
        {AUX_BUTTONS.map((button) => (
          <button
            key={button.id}
            type="button"
            disabled={disabled}
            onPointerDown={(event) => {
              event.preventDefault();
              handlePress(button);
            }}
            onPointerUp={() => handleRelease(button)}
            onPointerLeave={() => handleRelease(button)}
            onPointerCancel={() => handleRelease(button)}
            onContextMenu={(event) => event.preventDefault()}
            className={`rounded-lg px-2 py-2 text-left text-sm font-semibold uppercase tracking-wide text-white transition ${button.color} disabled:opacity-30`}
          >
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MobileLandscapeAuxColumn() {
  return (
    <div className="flex h-full flex-col gap-1">
      <AuxMotorPanel orientation="landscape" />
    </div>
  );
}

export function MobileLandscapeControlColumn() {
  return (
    <div className="flex h-full flex-col gap-1">
      <MobileJoystickPanel layout="landscape" />
    </div>
  );
}

export default function MobilePortraitControls() {
  return (
    <section className="w-full">
      <div className="grid grid-cols-2 gap-1">
        <AuxMotorPanel orientation="portrait" />
        <MobileJoystickPanel layout="portrait" />
      </div>
    </section>
  );
}
