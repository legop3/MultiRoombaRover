// Top-left Corner Pod
// Purpose: Shows the user's current-turn or queue-wait countdown and the rover identity expansion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useControlSelector } from '../../../../controls/index.js';
import { useSessionSelector } from '../../../../context/SessionContext.jsx';
import { useSharedClock } from '../../../../hooks/useSharedClock.js';
import RoverLabel from '../../../RoverLabel/index.jsx';
import CornerPodToggle from './CornerPodToggle.jsx';
import ExpansionPanel from './ExpansionPanel.jsx';
import usePodVisibility from './usePodVisibility.js';

export default function TopLeftPod({ roverId }) {
  const [timerOpen, setTimerOpen] = usePodVisibility('turnTimer', true);
  const [nameOpen, setNameOpen] = usePodVisibility('roverName', true);
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const turnInfo = useSessionSelector((state) => state.session?.turnQueues?.[roverId] || null);
  const activeDriverId = useSessionSelector((state) => state.session?.activeDrivers?.[roverId] || null);
  const lastControlIntentAt = useControlSelector((control) => control.state.lastControlIntentAt);
  const deadline = turnInfo?.deadline || null;
  const idleDeadline = turnInfo?.idleDeadline || null;
  const queue = turnInfo?.queue || [];
  // Direct ownership is published independently from the detailed queue and is
  // therefore the reliable initial-load/reconnect source for the current turn.
  const currentDriverId = activeDriverId || turnInfo?.current || null;
  const currentIndex = currentDriverId ? queue.indexOf(currentDriverId) : -1;
  const userIndex = socketId ? queue.indexOf(socketId) : -1;
  const turnActive = mode === 'turns' && queue.length > 1 && currentIndex >= 0 && userIndex >= 0;
  const hasTurnDeadline = Boolean(turnActive && deadline);
  const now = useSharedClock(1000, hasTurnDeadline);
  const currentTurnSeconds = hasTurnDeadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const idleSkipSeconds = idleDeadline ? Math.max(0, Math.ceil((idleDeadline - now) / 1000)) : null;
  const turnsAhead = turnActive ? (userIndex - currentIndex + queue.length) % queue.length : null;
  const seconds = currentTurnSeconds == null || turnsAhead == null
    ? null
    : currentTurnSeconds + Math.max(0, turnsAhead - 1) * 60;
  const isCurrentTurn = turnsAhead === 0;
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
    /*
      The server's rover turns are sixty seconds long. Waiting users need one complete
      turn added for each driver between the current driver and themselves. A complete
      queue rotation is a stable scale across handoffs, so the ring drains continuously
      instead of jumping back to full when the current driver changes.
    */
    const rotationSeconds = Math.max(60, queue.length * 60);
    return Math.max(0, Math.min(1, seconds / rotationSeconds));
  }, [queue.length, seconds]);
  const visibleGaugePercent = showTurnCue && idleSkipSeconds != null
    // The server's initial inactivity grace is seven seconds. Mirroring that known lifecycle
    // makes the enlarged ring itself reinforce the prominent skip countdown in the center.
    ? Math.max(0, Math.min(1, idleSkipSeconds / 7))
    : gaugePercent;
  const showTimer = Boolean(turnActive && timerOpen);
  const showLargeTimer = isWaitingForTurn || showTurnCue;
  const timerLabel = seconds == null
    // Ownership should remain visible while the detailed deadline is in flight.
    ? isCurrentTurn ? 'Your turn' : 'Waiting'
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : `${seconds}s`;

  return (
    <div className={`pointer-events-auto absolute left-0 top-0 flex items-start ${showLargeTimer ? 'z-[100]' : 'z-20'}`}>
      {showTimer ? (
        <div
          className={`relative flex items-center justify-center transition-[width,height,border-radius,background-color] duration-500 ease-out motion-reduce:transition-none ${
            showLargeTimer
              // The waiting/handoff state replaces the old full-screen turn cue.
              // It must be opaque and above every other in-video HUD surface so
              // sensor graphics, chat, and docking controls cannot muddy the text.
              ? 'h-[25.5rem] w-[25.5rem] rounded-br-[12.75rem] bg-black'
              : 'h-[8.5rem] w-[8.5rem] rounded-br-[4.25rem] bg-black/60'
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
                <span className={`mb-2 text-[1.75rem] font-bold leading-tight transition-colors duration-300 ${showTurnCue ? 'text-amber-200' : 'text-sky-100'}`}>
                  {showTurnCue ? 'It’s your turn!' : 'Someone else is driving'}
                </span>
                <strong className="text-[3.375rem] leading-none">
                  {showTurnCue && idleSkipSeconds != null ? `${idleSkipSeconds}s` : timerLabel}
                </strong>
                <span className={`mt-2 text-[1rem] font-semibold leading-tight ${showTurnCue ? 'text-amber-200' : 'text-sky-200'}`}>
                  {showTurnCue
                    ? idleSkipSeconds != null
                      ? 'Start driving or your turn will be skipped'
                      : 'You’re driving'
                    : 'until your turn'}
                </span>
              </>
            ) : (
              <>
                <strong className="text-lg leading-none">{timerLabel}</strong>
                {seconds != null ? <span className="mt-1 text-[0.6rem] font-semibold text-sky-200">left</span> : null}
              </>
            )}
          </span>
          <CornerPodToggle corner="top-left" expanded label="Hide turn timer" onClick={() => setTimerOpen(false)} />
        </div>
      ) : turnActive ? (
        <CornerPodToggle corner="top-left" expanded={false} label="Show turn timer" onClick={() => setTimerOpen(true)} />
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
        openLabel="Show rover name"
        closeLabel="Hide rover name"
      >
          <RoverLabel roverId={roverId} fallback={roverId} className="px-2 py-1 text-base" />
      </ExpansionPanel>
    </div>
  );
}
