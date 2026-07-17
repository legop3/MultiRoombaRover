// Overcurrent Overlay
// Purpose: Shows server-authoritative motor limiting, stop, recovery, and administrator-bypass status.
// Scope: Renders protection state only; it never calculates stress or changes motor commands.

import React, { useMemo } from 'react';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useOvercurrentLimiter } from '../../../controls/index.js';
import { OVERCURRENT_LABELS } from './constants.js';

function OvercurrentOverlay({ roverId = null, overcurrentLimiter = null, compact = false }) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const internalLimiter = useOvercurrentLimiter(effectiveRoverId);
  const protection = overcurrentLimiter ?? internalLimiter;
  const status = protection?.status || 'idle';
  const motors = protection?.motors || {};
  const activeMotors = useMemo(
    () => Object.entries(motors)
      .filter(([, motor]) => Boolean(motor?.overcurrent) || Number(motor?.stress) > 0)
      .map(([key]) => key),
    [motors],
  );

  if (status === 'idle') return null;

  const stopReason = protection?.drive?.stopReason;
  const displayMotors = stopReason ? [stopReason] : activeMotors;
  const labels = displayMotors.map((name) => OVERCURRENT_LABELS[name] || name);
  const highestStress = displayMotors.reduce(
    (highest, name) => Math.max(highest, Number(motors?.[name]?.stress) || 0),
    0,
  );
  const driveCap = Number.isFinite(protection?.drive?.cap) ? protection.drive.cap : 1;
  const fillWidth = `${Math.round(Math.max(0, Math.min(1, highestStress)) * 100)}%`;
  const bypassed = status === 'bypassed';
  const stopped = status === 'stopped';
  const title = bypassed
    ? 'Overcurrent detected'
    : stopped
      ? 'Drive stopped'
      : status === 'recovering'
        ? 'Protection recovering'
        : 'Overcurrent limiting';
  const detail = bypassed
    ? 'Admin bypass'
    : stopped && protection?.drive?.requiresNeutral
      ? `${labels.join(', ') || 'Wheel stall'} · release controls to resume`
      : status === 'limiting'
        ? `${labels.join(', ')} · output ${Math.round(driveCap * 100)}%`
        : labels.join(', ');
  const containerClass = bypassed
    ? 'h-[3.5rem] w-[14rem]'
    : compact
      ? 'h-[3.5rem] w-[14rem]'
      : 'h-[7rem] w-[22rem]';
  const titleClass = compact || bypassed ? 'text-base' : 'text-3xl';
  const detailClass = compact || bypassed ? 'text-xs' : 'text-base';
  const backgroundClass = bypassed ? 'bg-amber-950/75' : 'bg-red-950/70';
  const fillClass = bypassed ? 'bg-amber-700/50' : 'bg-red-700/60';

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center ${backgroundClass} ${containerClass}`}
    >
      <div className="relative h-full w-full overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${fillClass}`} style={{ width: fillWidth }} />
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-2 text-center font-semibold text-white">
          <div className={titleClass}>{title}</div>
          <div className={`font-medium ${detailClass}`}>{detail}</div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(OvercurrentOverlay);
