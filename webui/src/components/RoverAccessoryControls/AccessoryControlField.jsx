// Accessory Control Field
// Purpose: Maps one firmware-advertised generic control to a large rover-control surface.
// Scope: Owns browser-local values and input semantics; transport and device-specific behavior stay outside this file.
import { useCallback, useEffect, useRef, useState } from 'react';
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

const CARD_CLASS = 'mobile-touch-control rounded-xl border-2 px-2.5 py-2 text-slate-50 shadow-md';
const DISABLED_CLASS = 'disabled:cursor-not-allowed disabled:opacity-40';

function SliderControl({ peripheralId, control, disabled, send, value: storedValue }) {
  const minimum = integerBound(control.min, 0);
  const maximum = integerBound(control.max, minimum);
  const value = Number.isInteger(storedValue)
    ? clampInteger(storedValue, minimum, maximum)
    : minimum;

  const updateValue = (event) => {
    const next = clampInteger(event.target.value, minimum, maximum);
    send(peripheralId, control.id, next);
  };

  return (
    <label className={`${CARD_CLASS} block border-emerald-300/70 bg-emerald-900`}>
      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span>{control.name}</span>
        <span className="font-mono text-emerald-100">{value}</span>
      </span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step="1"
        value={value}
        disabled={disabled}
        onChange={updateValue}
        className={`mobile-touch-control mt-2 h-8 w-full cursor-pointer accent-emerald-300 ${DISABLED_CLASS}`}
      />
      <span className="flex justify-between text-xs text-emerald-100/80" aria-hidden="true">
        <span>{minimum}</span>
        <span>{maximum}</span>
      </span>
    </label>
  );
}

function ToggleControl({ peripheralId, control, disabled, send, value }) {
  const enabled = value === true;

  const toggle = () => {
    if (disabled) return;
    const next = !enabled;
    send(peripheralId, control.id, next);
    triggerTouchHaptic('button');
  };

  return (
    <button
      type="button"
      aria-pressed={enabled}
      disabled={disabled}
      onClick={toggle}
      className={`${CARD_CLASS} ${DISABLED_CLASS} flex min-h-[4.5rem] w-full items-center justify-between gap-2 font-semibold transition active:scale-[0.99] ${enabled ? 'border-emerald-300/70 bg-emerald-800 text-emerald-50' : 'border-amber-300/70 bg-amber-900 text-amber-50'}`}
    >
      <span>{control.name}</span>
      <span className="text-sm">{enabled ? 'On' : 'Off'}</span>
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
    // Always pair a successful press with false. In particular, this cleanup
    // path runs when a touch is cancelled or the Accessories view is replaced.
    send(peripheralId, control.id, false);
  }, [control.id, peripheralId, send]);

  const press = useCallback(() => {
    if (disabled || pressedRef.current) return;
    pressedRef.current = true;
    send(peripheralId, control.id, true);
  }, [control.id, disabled, peripheralId, send]);

  useEffect(() => release, [release]);
  useEffect(() => {
    // Browsers do not guarantee pointer-up after a held button becomes
    // disabled. Proactively emit the neutral edge at the permission boundary.
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
      className={`${CARD_CLASS} ${DISABLED_CLASS} flex min-h-[4.5rem] w-full items-center justify-center text-center font-semibold transition active:scale-[0.99] ${pressed ? 'border-fuchsia-200 bg-fuchsia-600 text-white' : 'border-fuchsia-300/70 bg-fuchsia-900 text-fuchsia-50'}`}
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
    <label className={`${CARD_CLASS} block border-indigo-300/70 bg-indigo-900`}>
      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span>{control.name}</span>
        <span className="text-xs text-indigo-100/80">{minimum}–{maximum}</span>
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={minimum}
        max={maximum}
        step="1"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        className={`mobile-touch-control mt-2 min-h-11 w-full rounded-lg border border-indigo-200/70 bg-indigo-950 px-3 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ${DISABLED_CLASS}`}
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
    <label className={`${CARD_CLASS} block border-sky-300/70 bg-sky-900`}>
      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span>{control.name}</span>
        <span className="text-xs text-sky-100/80">{Array.from(value).length}/{maximumLength}</span>
      </span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(trimUnicode(event.target.value, maximumLength))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        className={`mobile-touch-control mt-2 min-h-11 w-full rounded-lg border border-sky-200/70 bg-sky-950 px-3 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-200 ${DISABLED_CLASS}`}
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
