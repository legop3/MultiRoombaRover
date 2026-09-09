// Accessory Control Field
// Purpose: Maps one firmware-advertised generic control to a compact rover-control surface.
// Scope: Owns browser-local input semantics; transport and device-specific behavior stay outside this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { triggerTouchHaptic } from '../../lib/touchHaptics.js';

function integerBound(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function clampInteger(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

function trimUnicode(value, maximumLength) {
  // Array.from counts Unicode code points instead of UTF-16 code units. That
  // mirrors Go's rune-count validation for emoji and other non-BMP characters.
  return Array.from(String(value ?? '')).slice(0, maximumLength).join('');
}

const CARD_CLASS = 'mobile-touch-control rounded-xl border-2 px-2 py-1 text-slate-50';
const DISABLED_CLASS = 'disabled:cursor-not-allowed disabled:opacity-40';

function SliderControl({ peripheralId, control, disabled, send, value: storedValue }) {
  const minimum = integerBound(control.min, 0);
  const maximum = integerBound(control.max, minimum);
  const value = Number.isInteger(storedValue)
    ? clampInteger(storedValue, minimum, maximum)
    : minimum;
  const trackRef = useRef(null);
  const pointerIdRef = useRef(null);
  const lastHapticValueRef = useRef(value);

  const valuePercent = useMemo(() => {
    if (maximum === minimum) return 50;
    return ((value - minimum) / (maximum - minimum)) * 100;
  }, [maximum, minimum, value]);

  const sendValue = useCallback((nextValue) => {
    const next = clampInteger(nextValue, minimum, maximum);
    const hapticStep = Math.max(1, Math.round((maximum - minimum) / 20));
    if (Math.abs(next - lastHapticValueRef.current) >= hapticStep) {
      triggerTouchHaptic('camera');
      lastHapticValueRef.current = next;
    }
    send(peripheralId, control.id, next);
  }, [control.id, maximum, minimum, peripheralId, send]);

  const valueFromPointer = useCallback((event) => {
    const track = trackRef.current;
    if (!track) return value;
    const bounds = track.getBoundingClientRect();
    const rawPercent = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    return minimum + Math.max(0, Math.min(1, rawPercent)) * (maximum - minimum);
  }, [maximum, minimum, value]);

  const updateFromPointer = useCallback((event) => {
    sendValue(valueFromPointer(event));
  }, [sendValue, valueFromPointer]);

  const handlePointerDown = useCallback((event) => {
    if (disabled || pointerIdRef.current !== null) return;
    // This follows VerticalCameraTilt's custom pointer-capture path so a range
    // drag remains reliable while another finger is operating the drive pad.
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    lastHapticValueRef.current = value;
    trackRef.current?.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  }, [disabled, updateFromPointer, value]);

  const handlePointerMove = useCallback((event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateFromPointer(event);
  }, [updateFromPointer]);

  const handlePointerEnd = useCallback((event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    pointerIdRef.current = null;
    trackRef.current?.releasePointerCapture?.(event.pointerId);
  }, []);

  const handleKeyDown = (event) => {
    if (disabled) return;
    let next = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + 1;
    if (event.key === 'Home') next = minimum;
    if (event.key === 'End') next = maximum;
    if (next == null) return;
    event.preventDefault();
    sendValue(next);
  };

  return (
    <div className={`${CARD_CLASS} border-emerald-300/70 bg-emerald-900 ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}>
      <div className="flex items-center justify-between gap-1 text-sm font-semibold">
        <span className="min-w-0 truncate">{control.name}</span>
        <span className="shrink-0 font-mono text-emerald-100">{value}</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label={control.name}
        aria-valuemin={minimum}
        aria-valuemax={maximum}
        aria-valuenow={value}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={(event) => {
          if (pointerIdRef.current === event.pointerId) pointerIdRef.current = null;
        }}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        style={{ touchAction: 'none' }}
        className="mobile-touch-control mobile-drag-control relative mt-1 h-7 w-full rounded-full border border-emerald-100/80 bg-emerald-950 shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
      >
        {/* An inset track gives the thumb room to remain entirely inside the
            card at both endpoints without browser-specific range styling. */}
        <div className="pointer-events-none absolute inset-1">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-emerald-400"
            style={{ width: `${valuePercent}%` }}
          />
        </div>
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-950 bg-emerald-200 shadow"
          style={{ left: `clamp(0.4375rem, ${valuePercent}%, calc(100% - 0.4375rem))` }}
        />
      </div>
    </div>
  );
}

function ToggleControl({ peripheralId, control, disabled, send, value }) {
  const enabled = value === true;

  const toggle = () => {
    if (disabled) return;
    send(peripheralId, control.id, !enabled);
    triggerTouchHaptic('button');
  };

  return (
    <button
      type="button"
      aria-pressed={enabled}
      disabled={disabled}
      onClick={toggle}
      className={`${CARD_CLASS} ${DISABLED_CLASS} flex min-h-12 w-full items-center justify-between gap-1 font-semibold transition active:scale-[0.99] ${enabled ? 'border-emerald-300/70 bg-emerald-800 text-emerald-50' : 'border-amber-300/70 bg-amber-900 text-amber-50'}`}
    >
      <span className="min-w-0 truncate">{control.name}</span>
      <span className="shrink-0 text-xs">{enabled ? 'On' : 'Off'}</span>
    </button>
  );
}

function MomentaryControl({ peripheralId, control, disabled, send, value }) {
  const pressed = value === true;
  const pressedRef = useRef(false);
  const pointerIdRef = useRef(null);

  const release = useCallback(() => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    pointerIdRef.current = null;
    // Always pair a successful press with false, including cancellation,
    // permission loss, and replacement of the Accessories view.
    send(peripheralId, control.id, false);
  }, [control.id, peripheralId, send]);

  const press = useCallback(() => {
    if (disabled || pressedRef.current) return;
    pressedRef.current = true;
    send(peripheralId, control.id, true);
  }, [control.id, disabled, peripheralId, send]);

  useEffect(() => release, [release]);
  useEffect(() => {
    if (disabled) release();
  }, [disabled, release]);

  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onPointerDown={(event) => {
        if (disabled || pointerIdRef.current != null) return;
        event.preventDefault();
        pointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        press();
      }}
      onPointerUp={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        release();
        triggerTouchHaptic('button');
      }}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          press();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          release();
          triggerTouchHaptic('button');
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
      className={`${CARD_CLASS} ${DISABLED_CLASS} flex min-h-12 w-full items-center justify-center text-center font-semibold transition active:scale-[0.99] ${pressed ? 'border-fuchsia-200 bg-fuchsia-600 text-white' : 'border-fuchsia-300/70 bg-fuchsia-900 text-fuchsia-50'}`}
    >
      {control.name}
    </button>
  );
}

function NumberControl({ peripheralId, control, disabled, send, value: storedValue }) {
  const minimum = integerBound(control.min, 0);
  const maximum = integerBound(control.max, minimum);
  const initialValue = Number.isInteger(storedValue)
    ? clampInteger(storedValue, minimum, maximum)
    : minimum;
  const [value, setValue] = useState(String(initialValue));
  const lastSentRef = useRef(initialValue);

  const commit = () => {
    const next = clampInteger(value, minimum, maximum);
    setValue(String(next));
    if (disabled || next === lastSentRef.current) return;
    lastSentRef.current = next;
    send(peripheralId, control.id, next);
    triggerTouchHaptic('button');
  };

  return (
    <label className={`${CARD_CLASS} flex min-h-12 items-center gap-1 border-indigo-300/70 bg-indigo-900`}>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{control.name}</span>
      <input
        type="number"
        inputMode="numeric"
        min={minimum}
        max={maximum}
        step="1"
        value={value}
        disabled={disabled}
        aria-label={`${control.name}, ${minimum} to ${maximum}`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        className={`mobile-touch-control h-9 w-[45%] min-w-16 rounded-lg border border-indigo-200/70 bg-indigo-950 px-1.5 text-right text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ${DISABLED_CLASS}`}
      />
    </label>
  );
}

function TextControl({ peripheralId, control, disabled, send, value: storedValue }) {
  const maximumLength = Math.max(1, integerBound(control.maxLength, 1));
  const initialValue = typeof storedValue === 'string'
    ? trimUnicode(storedValue, maximumLength)
    : '';
  const [value, setValue] = useState(initialValue);
  const lastSentRef = useRef(initialValue);

  const commit = () => {
    const next = trimUnicode(value, maximumLength);
    setValue(next);
    if (disabled || next === lastSentRef.current) return;
    lastSentRef.current = next;
    send(peripheralId, control.id, next);
    triggerTouchHaptic('button');
  };

  return (
    <label className={`${CARD_CLASS} flex min-h-12 items-center gap-1 border-sky-300/70 bg-sky-900`}>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{control.name}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        aria-label={`${control.name}, maximum ${maximumLength} characters`}
        onChange={(event) => setValue(trimUnicode(event.target.value, maximumLength))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        className={`mobile-touch-control h-9 w-[55%] min-w-20 rounded-lg border border-sky-200/70 bg-sky-950 px-1.5 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-200 ${DISABLED_CLASS}`}
      />
    </label>
  );
}

export default function AccessoryControlField(props) {
  switch (props.control?.type) {
    case 'slider':
      return <SliderControl {...props} />;
    case 'button':
      return props.control.mode === 'momentary'
        ? <MomentaryControl {...props} />
        : <ToggleControl {...props} />;
    case 'number':
      return <NumberControl {...props} />;
    case 'text':
      return <TextControl {...props} />;
    default:
      // roverd validates the four-type contract before publishing metadata.
      // Returning nothing remains a defensive boundary for stale servers.
      return null;
  }
}
