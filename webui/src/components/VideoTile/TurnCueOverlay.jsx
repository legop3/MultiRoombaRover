// Turn Cue Overlay
// Purpose: Defines the Turn Cue Overlay module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React from 'react';

export default function TurnCueOverlay({
  mobileHud = false,
  isActiveDriver = false,
  idleSkipSeconds = null,
}) {
  const titleClass = mobileHud ? 'text-3xl' : 'text-5xl';
  const subClass = mobileHud ? 'text-xs' : 'text-sm';
  const timerClass = mobileHud ? 'text-[0.55rem]' : 'text-[0.75rem]';
  const padClass = mobileHud ? 'px-4 py-3' : 'px-6 py-4';
  const showCountdown = isActiveDriver && typeof idleSkipSeconds === 'number';
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55">
      <div className={`flex flex-col items-center gap-0.5 rounded border border-amber-300/80 bg-black/70 ${padClass}`}>
        <div className={`font-semibold text-amber-200 ${titleClass}`}>IT IS YOUR TURN!</div>
        <div className={`text-amber-200/80 ${subClass}`}>Start driving!</div>
        {showCountdown ? (
          <div className={`text-red-100/90 ${timerClass}`}>
            Idle skip in {idleSkipSeconds}s
          </div>
        ) : null}
      </div>
    </div>
  );
}
