// Top-left Corner Pod
// Purpose: Renders the caller's turn-display object without knowing its operating mode.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useControlSelector } from '../../../../controls/index.js';
import { useSharedClock } from '../../../../hooks/useSharedClock.js';
import RoverLabel from '../../../RoverLabel/index.jsx';
import CornerPodToggle from './CornerPodToggle.jsx';
import ExpansionPanel from './ExpansionPanel.jsx';
import usePodVisibility from './usePodVisibility.js';

export default function TopLeftPod({ turns, compact = false }) {
  const [timerOpen, setTimerOpen] = usePodVisibility('turnTimer', true);
  const [nameOpen, setNameOpen] = usePodVisibility('roverName', true);
  const lastControlIntentAt = useControlSelector((control) => control.state.lastControlIntentAt);
  const { target, labels, enabled: turnActive, queueLength, turnsAhead, isActive: isCurrentTurn } = turns;
  const deadline = turns.deadline;
  const idleDeadline = turns.idleDeadline;
  const durationSeconds = turns.durationMs / 1000;
  const hasTurnDeadline = Boolean(turnActive && deadline);
  const now = useSharedClock(1000, hasTurnDeadline);
  const currentTurnSeconds = hasTurnDeadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const idleSkipSeconds = idleDeadline ? Math.max(0, Math.ceil((idleDeadline - now) / 1000)) : null;
  const seconds = currentTurnSeconds == null || turnsAhead == null
    ? null
    : currentTurnSeconds + Math.max(0, turnsAhead - 1) * durationSeconds;
  const isWaitingForTurn = turnActive && !isCurrentTurn;
  const [showTurnCue, setShowTurnCue] = useState(false);
  const [turnCueStartedAt, setTurnCueStartedAt] = useState(null);
  const previousCurrentRef = useRef(null);

  useEffect(() => {
    const wasCurrent = previousCurrentRef.current;
    previousCurrentRef.current = isCurrentTurn;
    let timer = 0;

    if (turnActive && isCurrentTurn && wasCurrent !== true) {
      const startedAt = Date.now();
      /*
        A direct-load current turn and a live ownership handoff both need the same cue. Defer
        the visual state update by one task to remain compatible with the repo's React Compiler
        rules while preserving the actual handoff timestamp for the minimum display period.
      */
      timer = setTimeout(() => {
        setTurnCueStartedAt(startedAt);
        setShowTurnCue(true);
      }, 0);
    } else if ((!turnActive || !isCurrentTurn) && showTurnCue) {
      timer = setTimeout(() => {
        setShowTurnCue(false);
        setTurnCueStartedAt(null);
      }, 0);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isCurrentTurn, showTurnCue, turnActive]);

  useEffect(() => {
    if (!showTurnCue || !turnCueStartedAt || lastControlIntentAt <= turnCueStartedAt) return undefined;
    /*
      The first real control intent proves the user has noticed and started driving. Keep the
      cue for at least two seconds anyway, then return to the compact timer. With no input the
      cue remains large so the live server idle-skip deadline cannot be overlooked.
    */
    const remainingMinimumMs = Math.max(0, 2000 - (Date.now() - turnCueStartedAt));
    const timer = setTimeout(() => setShowTurnCue(false), remainingMinimumMs);
    return () => clearTimeout(timer);
  }, [lastControlIntentAt, showTurnCue, turnCueStartedAt]);
  const gaugePercent = useMemo(() => {
    if (seconds == null) return 0;
    // Scale waiting time by this target's actual turn duration. PTZ and rover
    // turns have different lengths, but use the same presentation.
    const rotationSeconds = Math.max(durationSeconds, queueLength * durationSeconds);
    return Math.max(0, Math.min(1, seconds / rotationSeconds));
  }, [durationSeconds, queueLength, seconds]);
  const visibleGaugePercent = showTurnCue && idleSkipSeconds != null
    // The caller supplies its inactivity grace alongside the idle deadline.
    ? Math.max(0, Math.min(1, idleSkipSeconds / (turns.idleGraceMs / 1000)))
    : gaugePercent;
  const showTimer = Boolean(turnActive && timerOpen);
  const showLargeTimer = isWaitingForTurn || showTurnCue;
  const timerLabel = seconds == null
    // Ownership should remain visible while the detailed deadline is in flight.
    ? isCurrentTurn ? labels.activeTimer : labels.waitingTimer
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : `${seconds}s`;

  return (
    <div className={`pointer-events-auto absolute left-0 top-0 flex items-start ${showLargeTimer ? 'z-100' : 'z-20'}`}>
      {showTimer ? (
        <div
          className={`relative flex items-center justify-center transition-[width,height,border-radius,background-color] duration-500 ease-out motion-reduce:transition-none ${
            showLargeTimer
              // The waiting/handoff state replaces the old full-screen turn cue.
              // It must be opaque and above every other in-video HUD surface so
              // sensor graphics, chat, and docking controls cannot muddy the text.
              ? compact ? 'h-[min(12rem,45vw)] w-[min(12rem,45vw)] rounded-br-[6rem] bg-black' : 'h-102 w-102 rounded-br-[12.75rem] bg-black'
              : compact ? 'h-24 w-24 rounded-br-[3rem] bg-black/60' : 'h-34 w-34 rounded-br-[4.25rem] bg-black/60'
          }`}
        >
          {/* The SVG fills the shell. Its circle geometry supplies the same slim visible inset
              used by the other pods instead of stacking SVG padding on top of shell padding. */}
          <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="41" fill="none" stroke="#334155" strokeWidth="10" />
            <circle cx="50" cy="50" r="41" fill="none" stroke={showTurnCue ? '#fbbf24' : '#38bdf8'} strokeWidth="10" strokeLinecap="round" pathLength="1" strokeDasharray={`${visibleGaugePercent} 1`} />
          </svg>
          <span className={`absolute flex flex-col items-center text-center text-white ${showLargeTimer ? 'max-w-[55%]' : 'max-w-[70%]'}`}>
            {/* The handoff text replaces the retired desktop full-screen TurnsOverlay.
                Typography grows with the pod, while the corner toggle deliberately remains
                fixed-size so it never becomes a giant obstruction over the video. */}
            {showLargeTimer ? (
              <>
                <span className={`${compact ? 'mb-1 text-sm' : 'mb-2 text-[1.75rem]'} font-bold leading-tight transition-colors duration-300 ${showTurnCue ? 'text-amber-200' : 'text-sky-100'}`}>
                  {showTurnCue ? labels.handoff : labels.waiting}
                </span>
                <strong className={`${compact ? "text-2xl" : "text-[3.375rem]"} leading-none`}>
                  {showTurnCue && idleSkipSeconds != null ? `${idleSkipSeconds}s` : timerLabel}
                </strong>
                <span className={`${compact ? 'mt-1 text-xs' : 'mt-2 text-[1rem]'} font-semibold leading-tight ${showTurnCue ? 'text-amber-200' : 'text-sky-200'}`}>
                  {showTurnCue
                    ? idleSkipSeconds != null
                      ? labels.idleWarning
                      : labels.active
                    : labels.untilTurn}
                </span>
              </>
            ) : (
              <>
                <strong className="text-lg leading-none">{timerLabel}</strong>
                {seconds != null ? <span className="mt-1 text-[0.6rem] font-semibold text-sky-200">{labels.timeRemaining}</span> : null}
              </>
            )}
          </span>
          <CornerPodToggle corner="top-left" expanded label={labels.hideTimer} onClick={() => setTimerOpen(false)} />
        </div>
      ) : turnActive ? (
        <CornerPodToggle corner="top-left" expanded={false} label={labels.showTimer} onClick={() => setTimerOpen(true)} />
      ) : null}

      {/* The rover name is an independent edge expansion. Its visibility control lives in
          the expansion itself, and its position naturally moves into the corner whenever
          the conditional timer pod is absent or manually collapsed. */}
      <ExpansionPanel
        open={nameOpen}
        onOpenChange={setNameOpen}
        anchorClassName={`relative shrink-0 ${showTimer || !turnActive ? '' : 'ml-10'}`}
        panelClassName={`flex h-11 min-w-max items-center gap-2 bg-black/60 px-2 pt-3 ${showTimer ? '' : 'rounded-br-xl'}`}
        openDirection="down"
        closeDirection="up"
        openLabel={labels.showName}
        closeLabel={labels.hideName}
      >
          <RoverLabel name={target.name} color={target.color} fallback={target.fallback} className="px-2 py-1 text-base" />
      </ExpansionPanel>
    </div>
  );
}
