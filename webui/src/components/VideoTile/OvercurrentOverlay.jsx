// Overcurrent warning overlay.
import React from 'react';
import { OVERCURRENT_LABELS } from './constants.js';

export default function OvercurrentOverlay({ motors, fill = 0, compact = false }) {
  if (!motors?.length) return null;
  const safeLabels = motors.map((name) => OVERCURRENT_LABELS[name] || name);
  const containerClass = compact ? 'w-[12rem] h-[3.5rem]' : 'w-[20rem] h-[7rem]';
  const padClass = compact ? 'px-2 py-1' : 'px-4 py-2';
  const textClass = compact ? 'text-lg' : 'text-4xl';
  const subTextClass = compact ? 'text-xs' : 'text-xl';
  const safeFill = Math.max(0, Math.min(1, fill));
  const fillWidth = `${Math.round(safeFill * 100)}%`;
  return (
    <div
      className={`pointer-events-none absolute flex items-center justify-center bg-red-900/50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${containerClass}`}
    >
      <div className="relative h-full w-full">
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full bg-red-700/60" style={{ width: fillWidth }} />
        </div>
        <div className={`relative z-10 flex h-full w-full flex-col items-center justify-center text-center font-semibold text-white animate-pulse ${textClass} ${padClass}`}>
          <div>OVERCURRENT</div>
          <div className={`mt-0 font-medium text-white ${subTextClass}`}>{safeLabels.join(', ')}</div>
        </div>
      </div>
    </div>
  );
}
