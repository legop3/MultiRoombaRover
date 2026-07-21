// Vertical Camera Tilt
// Purpose: Provides the mobile-only camera tilt slider that supports simultaneous two-finger mobile driving.
// Scope: Owns pointer tracking and visual slider state for the compact vertical mobile camera control.
import { useCallback, useMemo, useRef } from 'react';
import { triggerTouchHaptic } from '../../lib/touchHaptics.js';

const HAPTIC_MIN_ANGLE_DELTA_DEGREES = 2;

function clampCameraAngle(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatCameraAngle(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}°`;
}

export default function VerticalCameraTilt({
  value,
  min,
  max,
  step = 0.5,
  disabled = false,
  onChange,
}) {
  const trackRef = useRef(null);
  const pointerIdRef = useRef(null);
  const lastHapticValueRef = useRef(null);

  const valuePercent = useMemo(() => {
    if (max === min) return 50;
    return ((clampCameraAngle(value, min, max) - min) / (max - min)) * 100;
  }, [max, min, value]);
  const disabledClass = disabled ? 'opacity-50' : '';

  const valueFromPointer = useCallback(
    (event) => {
      const track = trackRef.current;
      if (!track) return value;
      const rect = track.getBoundingClientRect();
      const usableHeight = Math.max(1, rect.height);
      const rawPercent = 1 - (event.clientY - rect.top) / usableHeight;
      const unclamped = min + clampCameraAngle(rawPercent, 0, 1) * (max - min);
      const stepped = Math.round(unclamped / step) * step;
      return clampCameraAngle(stepped, min, max);
    },
    [max, min, step, value],
  );

  const sendPointerValue = useCallback(
    (event) => {
      const next = valueFromPointer(event);

      /*
        Camera commands must retain the configured 0.5 or 0.1 degree precision,
        but physical feedback does not need to mirror every servo step. Require
        two degrees of accumulated travel so the ticks describe slider position
        without allowing pointer event frequency to control their cadence.
      */
      if (Math.abs(next - lastHapticValueRef.current) >= HAPTIC_MIN_ANGLE_DELTA_DEGREES) {
        triggerTouchHaptic('camera');
        lastHapticValueRef.current = next;
      }
      onChange?.(next);
    },
    [onChange, valueFromPointer],
  );

  const handlePointerDown = useCallback(
    (event) => {
      if (disabled) return;
      if (pointerIdRef.current !== null) return;

      /*
        Native vertical range inputs are unreliable as a second simultaneous
        touch on mobile Safari while the drive pad owns another active pointer.
        This custom track captures only the camera finger, so the drive thumb can
        continue moving without stealing or cancelling camera tilt updates.
      */
      event.preventDefault();
      pointerIdRef.current = event.pointerId;
      // Seed the slider value so its first position update is not mistaken for
      // two degrees of travel before the finger has actually moved that far.
      lastHapticValueRef.current = value;
      trackRef.current?.setPointerCapture?.(event.pointerId);
      sendPointerValue(event);
    },
    [disabled, sendPointerValue, value],
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (pointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      sendPointerValue(event);
    },
    [sendPointerValue],
  );

  const handlePointerEnd = useCallback((event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    pointerIdRef.current = null;
    trackRef.current?.releasePointerCapture?.(event.pointerId);
  }, []);

  return (
    <div className="mobile-touch-control flex h-full items-center justify-center gap-0.5">
      <span className="mobile-touch-control text-sm font-semibold text-emerald-50 [writing-mode:vertical-rl] rotate-180">
        Camera tilt
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Camera tilt"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? value : min}
        aria-valuetext={formatCameraAngle(value)}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={(event) => {
          if (pointerIdRef.current === event.pointerId) pointerIdRef.current = null;
        }}
        onContextMenu={(event) => event.preventDefault()}
        /*
          touchAction stays inline as a second line of defense because this is the
          element that must keep browser panning/zooming out of the multi-touch
          camera gesture.
        */
        style={{ touchAction: 'none' }}
        className={`mobile-touch-control mobile-drag-control relative h-full w-6 rounded-full border border-emerald-100/80 bg-emerald-950 shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 ${disabledClass}`.trim()}
      >
        <div
          className="pointer-events-none absolute inset-x-1 bottom-1 rounded-full bg-emerald-400"
          style={{ height: `${valuePercent}%` }}
        />
        <div
          className="pointer-events-none absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full border border-emerald-950 bg-emerald-200 shadow"
          style={{ bottom: `clamp(0.25rem, calc(${valuePercent}% - 0.4375rem), calc(100% - 1.125rem))` }}
        />
      </div>
    </div>
  );
}
