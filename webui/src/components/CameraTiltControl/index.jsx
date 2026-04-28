// Camera Tilt Control
// Purpose: Defines the Camera Tilt Control module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useRef, useState } from 'react';

function formatDegrees(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}°`;
}

function KeyPill({ label }) {
  if (!label) return null;
  return <span className="rounded border border-white/40 px-1 text-[0.7rem] text-white">{label}</span>;
}

export default function CameraTiltControl({
  value,
  min,
  max,
  step = 0.5,
  label = 'Camera Tilt',
  orientation = 'horizontal',
  onChange,
  onCommit,
  throttleMs = 0,
  disabled = false,
  keyDownLabel,
  keyUpLabel,
  className = '',
  labelRowClass = '',
  labelClass = '',
  valueClass = '',
  sliderClass = '',
  endpointClass = '',
  endpointLabelClass = '',
  accentClass = '',
  showValue = true,
  showEndpoints,
}) {
  const isVertical = orientation === 'vertical';
  const defaultShowEndpoints = !isVertical;
  const shouldShowEndpoints = typeof showEndpoints === 'boolean' ? showEndpoints : defaultShowEndpoints;
  const [pending, setPending] = useState(value);
  const draggingRef = useRef(false);
  const throttleRef = useRef(null);

  useEffect(() => {
    if (!draggingRef.current) {
      setPending(value);
    }
  }, [value]);

  useEffect(
    () => () => {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
      }
    },
    [],
  );

  const scheduleSend = (next) => {
    if (!onChange) return;
    if (throttleMs > 0) {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
      }
      throttleRef.current = setTimeout(() => {
        onChange(next);
      }, throttleMs);
      return;
    }
    onChange(next);
  };

  const handleSlider = (event) => {
    const next = Number.parseFloat(event.target.value);
    if (Number.isNaN(next)) return;
    draggingRef.current = true;
    setPending(next);
    scheduleSend(next);
  };

  const commitSlider = () => {
    draggingRef.current = false;
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
      throttleRef.current = null;
    }
    if (onCommit) {
      onCommit(pending);
    } else if (throttleMs > 0) {
      onChange?.(pending);
    }
  };

  if (typeof min !== 'number' || typeof max !== 'number') return null;

  const mergedSliderClass = [
    isVertical ? 'h-28 w-5' : 'w-full',
    accentClass,
    sliderClass,
  ]
    .filter(Boolean)
    .join(' ');

  const slider = (
    <input
      type="range"
      orient={isVertical ? 'vertical' : undefined}
      min={min}
      max={max}
      step={step}
      value={Number.isFinite(pending) ? pending : min}
      onChange={handleSlider}
      onMouseUp={commitSlider}
      onTouchEnd={commitSlider}
      onPointerUp={commitSlider}
      disabled={disabled}
      className={mergedSliderClass}
      style={
        isVertical
          ? { writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' }
          : undefined
      }
    />
  );

  if (isVertical) {
    return (
      <div className={`flex h-full flex-col items-center gap-0.5 ${className}`.trim()}>
        {showValue ? (
          <div className={`flex flex-col items-center ${labelRowClass}`.trim()}>
            <span className={valueClass}>{formatDegrees(value)}</span>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 items-center gap-0.5">
          <span className={labelClass}>{label}</span>
          {slider}
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-0.5 ${className}`.trim()}>
      <div className={`flex items-center justify-between ${labelRowClass}`.trim()}>
        <span className={labelClass}>{label}</span>
        {showValue ? <span className={valueClass}>{formatDegrees(value)}</span> : null}
      </div>
      <div>
        {slider}
        {shouldShowEndpoints ? (
          <div className={`mt-0 flex items-center justify-between ${endpointClass}`.trim()}>
            <span className={`flex items-center gap-0.5 ${endpointLabelClass}`.trim()}>
              {keyDownLabel ? <KeyPill label={keyDownLabel} /> : null}
              {formatDegrees(min)}
            </span>
            <span className={`flex items-center gap-0.5 ${endpointLabelClass}`.trim()}>
              {formatDegrees(max)}
              {keyUpLabel ? <KeyPill label={keyUpLabel} /> : null}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
