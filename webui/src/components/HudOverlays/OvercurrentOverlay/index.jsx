// Overcurrent Overlay
// Purpose: Defines the Overcurrent Overlay module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React from 'react';
import { useMemo } from 'react';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import { overcurrentFlagsEqual, selectOvercurrentFlags } from '../../../context/telemetryViews.js';
import { useOvercurrentLimiter } from '../../../controls/index.js';
import { OVERCURRENT_LABELS } from './constants.js';

function OvercurrentOverlay({ roverId = null, sensors, overcurrentLimiter = null, compact = false }) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const selectedOvercurrents = useVisualTelemetrySelector(effectiveRoverId, selectOvercurrentFlags, overcurrentFlagsEqual);
  const internalLimiter = useOvercurrentLimiter(effectiveRoverId);
  const resolvedOvercurrents = sensors?.wheelOvercurrents ?? selectedOvercurrents;
  const resolvedOvercurrentLimiter = overcurrentLimiter ?? internalLimiter ?? null;
  const overcurrentMotors = useMemo(
    () =>
      resolvedOvercurrents == null
        ? []
        : Object.entries(resolvedOvercurrents)
            .filter(([, active]) => Boolean(active))
            .map(([key]) => key),
    [resolvedOvercurrents],
  );
  const limiterCaps = resolvedOvercurrentLimiter?.caps || null;
  const limiterFill = useMemo(() => {
    if (!limiterCaps) return null;
    const driveCap = Number.isFinite(limiterCaps?.drive?.cap) ? limiterCaps.drive.cap : 1;
    const auxCap = Number.isFinite(limiterCaps?.aux?.cap) ? limiterCaps.aux.cap : 1;
    return Math.max(0, Math.min(1, 1 - Math.min(driveCap, auxCap)));
  }, [limiterCaps]);
  const limiterActive = Boolean(resolvedOvercurrentLimiter?.isActive);
  const motors = useMemo(
    () => (overcurrentMotors.length ? overcurrentMotors : limiterActive ? ['limiter'] : []),
    [overcurrentMotors, limiterActive],
  );
  const fill = limiterFill ?? (overcurrentMotors.length ? 1 : 0);

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

export default React.memo(OvercurrentOverlay);
