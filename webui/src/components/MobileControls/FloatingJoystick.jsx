// Floating Joystick
// Purpose: Defines the Floating Joystick module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useRef, useState } from 'react';
import { clampUnit } from '../../controls/controlMath.js';

const JOYSTICK_DEADZONE = 0.08;
const STRAIGHT_GATE_MIN_Y = 0.28;
const STRAIGHT_GATE_MIN_X = 0.10;
const STRAIGHT_GATE_Y_RATIO = 0.24;
const STEERING_CURVE = 1.25;
const THROTTLE_CURVE = 1.08;

function applySignedCurve(value, exponent) {
  if (!value) return 0;
  return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

function applyRadialDeadzone(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= JOYSTICK_DEADZONE) return { x: 0, y: 0 };

  // Rescaling the remaining travel keeps the joystick from feeling like it loses
  // range after the deadzone. A thumb that reaches the outer ring still sends a
  // full-strength command, but small center noise is ignored.
  const scaledMagnitude = (magnitude - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
  const ratio = scaledMagnitude / magnitude;
  return {
    x: clampUnit(x * ratio),
    y: clampUnit(y * ratio),
  };
}

function applyStraightGate(x, y) {
  const absY = Math.abs(y);
  const absX = Math.abs(x);
  if (absY < STRAIGHT_GATE_MIN_Y) return x;

  const gate = Math.min(0.45, Math.max(STRAIGHT_GATE_MIN_X, absY * STRAIGHT_GATE_Y_RATIO));
  if (absX <= gate) return 0;

  // Once the thumb clearly leaves the straight-ahead corridor, compress only the
  // part that was reserved for accidental drift. This avoids a hard steering jump
  // at the corridor edge while preserving full left/right authority.
  return Math.sign(x) * ((absX - gate) / (1 - gate));
}

function shapeDriveVector(rawX, rawY) {
  const deadzoned = applyRadialDeadzone(clampUnit(rawX), clampUnit(rawY));
  const gatedX = applyStraightGate(deadzoned.x, deadzoned.y);

  // Steering gets a stronger curve than throttle because accidental horizontal
  // drift is the main problem when driving straight on glass. Intentional turns
  // still reach full output as the thumb approaches the edge of the ring.
  return {
    x: clampUnit(applySignedCurve(gatedX, STEERING_CURVE)),
    y: clampUnit(applySignedCurve(deadzoned.y, THROTTLE_CURVE)),
    boost: false,
  };
}

export default function FloatingJoystick({ disabled, radius, onMove, onStop }) {
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
      const vector = shapeDriveVector(knobX / radius, -knobY / radius);
      setVisual((prev) => ({ ...prev, knob: { x: knobX, y: knobY } }));
      onMove?.(vector);
    },
    [disabled, onMove, radius],
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
    if (!disabled) return undefined;

    // Defer the disabled cleanup out of the effect body so React's set-state-in-effect
    // lint rule is satisfied while still clearing the active visual shortly after
    // rover access is lost.
    const timer = setTimeout(stopTracking, 0);
    return () => clearTimeout(timer);
  }, [disabled, stopTracking]);

  const heightClass = 'h-full';

  return (
    <div
      ref={containerRef}
      role="presentation"
      className={`relative w-full ${heightClass} select-none overflow-hidden rounded-xl border-2 border-slate-700 bg-slate-900/70 text-slate-100 shadow-md`}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onContextMenu={(event) => event.preventDefault()}
    >
      {!visual.active && (
        <div className="absolute inset-x-0 top-0 flex flex-col items-center gap-0 text-center pt-0.5">
          <span className="font-semibold text-slate-200">Joystick area</span>
          <span className="text-sm text-slate-300">Touch and hold to use the joystick</span>
        </div>
      )}
      {visual.active && (
        <>
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 bg-cyan-400/10 outline outline-2 outline-cyan-400/60 [clip-path:circle(50%)]"
            style={{
              height: radius * 2,
              left: visual.base.x,
              top: visual.base.y,
              width: radius * 2,
            }}
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
