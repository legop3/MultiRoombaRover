import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useControlSelector } from '../../../controls/index.js';
import { useSharedClock } from '../../../hooks/useSharedClock.js';
import SocialButton from '../../SocialButton/index.jsx';

function TurnsOverlay({
  roverId = null,
  mobileHud = false,
  turnModel = null,
}) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = turnModel?.targetId ?? roverId ?? assignedRoverId;
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const users = useSessionSelector((state) => state.session?.users ?? []);
  const turnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const activeDrivers = useSessionSelector((state) => state.session?.activeDrivers ?? {});
  const lastControlIntentAt = useControlSelector((control) => control.state.lastControlIntentAt);
  const [showTurnCue, setShowTurnCue] = useState(false);
  const [turnCueStartAt, setTurnCueStartAt] = useState(null);
  const [noticeFlashActive, setNoticeFlashActive] = useState(false);
  const [notTurnFlashAt, setNotTurnFlashAt] = useState(0);
  const lastTurnRef = useRef({ initialized: false, roverId: null, activeDriverId: null });
  const lastIntentRef = useRef(lastControlIntentAt || 0);
  const timerTextClass = mobileHud ? 'text-[0.5rem]' : 'text-[0.7rem]';
  const timerPadClass = mobileHud ? 'px-0.5 py-0.25' : 'px-1 py-0.5';
  const titleClass = mobileHud ? 'text-3xl' : 'text-5xl';
  const subClass = mobileHud ? 'text-xs' : 'text-sm';
  const cueTimerClass = mobileHud ? 'text-[0.55rem]' : 'text-[0.75rem]';
  const cuePadClass = mobileHud ? 'px-4 py-3' : 'px-6 py-4';
  const turnInfo = turnModel ? null : effectiveRoverId ? turnQueues?.[effectiveRoverId] : null;
  const activeDriverId = turnModel
    ? turnModel.activeId || null
    : effectiveRoverId
    ? activeDrivers?.[effectiveRoverId] || null
    : null;
  const isActiveDriver = turnModel
    ? Boolean(turnModel.isActive)
    : Boolean(socketId && activeDriverId === socketId);
  const isTurnsMode = turnModel ? Boolean(turnModel.enabled) : mode === 'turns';
  const now = useSharedClock(1000, isTurnsMode);
  const nextDriverId = useMemo(() => {
    if (turnModel) return turnModel.nextId || null;
    const queue = turnInfo?.queue || [];
    if (!queue.length || !turnInfo?.current || queue.length <= 1) return null;
    const idx = queue.findIndex((id) => id === turnInfo.current);
    if (idx === -1) return queue[0] || null;
    return queue[(idx + 1) % queue.length] || null;
  }, [turnInfo, turnModel]);
  const isNextDriver = turnModel
    ? Boolean(turnModel.isNext)
    : Boolean(socketId && nextDriverId === socketId);
  const deadline = turnModel ? turnModel.deadline || null : turnInfo?.deadline || null;
  const idleDeadline = turnModel ? turnModel.idleDeadline || null : turnInfo?.idleDeadline || null;
  const msUntilTurn = deadline ? deadline - now : null;
  const msUntilIdleSkip = idleDeadline ? idleDeadline - now : null;
  const totalRovers = roster.length;
  const totalDrivers = useMemo(() => {
    const unique = new Set();
    users.forEach((entry) => {
      const role = String(entry?.role || '');
      if (role === 'spectator') return;
      const turnRoverId = String(entry?.roverId || '').trim();
      const turnSocketId = String(entry?.socketId || '').trim();
      if (!turnRoverId || !turnSocketId) return;
      unique.add(turnSocketId);
    });
    return unique.size;
  }, [users]);
  const shouldUsePreviewByLoad = turnModel
    ? Boolean(turnModel.showPreviewReason)
    : isTurnsMode && totalDrivers > totalRovers;
  const isPreSwitchWindow =
    isTurnsMode && isNextDriver && msUntilTurn != null && msUntilTurn <= 5000 && msUntilTurn > 0;
  const showNotTurnNotice = turnModel
    ? Boolean(turnModel.showNotTurnNotice ?? (isTurnsMode && !isActiveDriver))
    : isTurnsMode && !isActiveDriver;
  const showPreviewReason = showNotTurnNotice && !isPreSwitchWindow && shouldUsePreviewByLoad;
  const turnSeconds =
    msUntilTurn != null && Number.isFinite(msUntilTurn) ? Math.max(0, Math.ceil(msUntilTurn / 1000)) : null;
  const idleSkipSeconds =
    msUntilIdleSkip != null && Number.isFinite(msUntilIdleSkip)
      ? Math.max(0, Math.ceil(msUntilIdleSkip / 1000))
      : null;
  const turnTimerText = useMemo(() => {
    if (!isTurnsMode || !isActiveDriver) return null;
    return turnSeconds != null ? `${turnSeconds}s left` : 'Your turn';
  }, [isTurnsMode, isActiveDriver, turnSeconds]);
  const notTurnCountdownText = useMemo(() => {
    if (!showNotTurnNotice || !isNextDriver || turnSeconds == null) return null;
    return `${turnSeconds} seconds until your turn.`;
  }, [showNotTurnNotice, isNextDriver, turnSeconds]);
  const showCountdown = isActiveDriver && typeof idleSkipSeconds === 'number';
  const turnTimerFlashActive = noticeFlashActive;

  useEffect(() => {
    /*
      Rover turns and PTZ turns now arrive through the same render path. Use the
      normalized isTurnsMode flag here instead of checking the server's rover
      mode directly, otherwise PTZ can render the notice but never trigger the
      "your turn" cue when camera ownership changes.
    */
    if (!isTurnsMode) {
      lastTurnRef.current = { initialized: false, roverId: null, activeDriverId: null };
      /*
        React Compiler's lint rules disallow immediate state writes from effect
        bodies. Defer the visual reset one macrotask; the ref reset above stays
        synchronous so later turn comparisons do not see stale ownership.
      */
      const resetTimer = setTimeout(() => {
        setShowTurnCue(false);
        setTurnCueStartAt(null);
      }, 0);
      return () => clearTimeout(resetTimer);
    }
    const lastTurn = lastTurnRef.current;
    const nextActiveDriverId = activeDriverId || null;
    if (!socketId || !effectiveRoverId) {
      lastTurnRef.current = { initialized: false, roverId: null, activeDriverId: null };
      /*
        No socket/target means there is no turn identity to compare. Reset the
        comparison ref immediately, then defer the visual state reset for the
        same React Compiler reason documented in the mode-disabled branch.
      */
      const resetTimer = setTimeout(() => {
        setShowTurnCue(false);
        setTurnCueStartAt(null);
      }, 0);
      return () => clearTimeout(resetTimer);
    }
    if (!lastTurn.initialized || lastTurn.roverId !== effectiveRoverId) {
      lastTurnRef.current = { initialized: true, roverId: effectiveRoverId, activeDriverId: nextActiveDriverId };
      return;
    }
    const becameActive =
      Boolean(lastTurn.activeDriverId) &&
      lastTurn.activeDriverId !== socketId &&
      nextActiveDriverId === socketId;
    let cueTimer = 0;
    if (becameActive) {
      const cueStartAt = Date.now();
      /*
        The active-turn cue is still caused by this ownership transition, but
        React Compiler wants visual state writes scheduled from an async edge.
        Capture the timestamp now so the cue dismissal logic compares against
        the actual transition time, not the later timer callback time.
      */
      cueTimer = setTimeout(() => {
        setShowTurnCue(true);
        setTurnCueStartAt(cueStartAt);
      }, 0);
    } else if (nextActiveDriverId !== socketId && showTurnCue) {
      cueTimer = setTimeout(() => {
        setShowTurnCue(false);
        setTurnCueStartAt(null);
      }, 0);
    }
    lastTurnRef.current = { initialized: true, roverId: effectiveRoverId, activeDriverId: nextActiveDriverId };
    return () => {
      if (cueTimer) clearTimeout(cueTimer);
    };
  }, [activeDriverId, effectiveRoverId, isTurnsMode, socketId, showTurnCue]);

  useEffect(() => {
    if (!showTurnCue || !turnCueStartAt) return;
    if (lastControlIntentAt > turnCueStartAt) {
      /*
        Hide the large "your turn" cue after the first control intent, but
        schedule the state write outside the effect body so this shared overlay
        remains compatible with the repo's React Compiler lint settings.
      */
      const timer = setTimeout(() => setShowTurnCue(false), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [lastControlIntentAt, showTurnCue, turnCueStartAt]);

  useEffect(() => {
    const lastIntent = Number(lastIntentRef.current) || 0;
    const nextIntent = Number(lastControlIntentAt) || 0;
    if (nextIntent > lastIntent && showNotTurnNotice) {
      const flashAt = Date.now();
      /*
        The "not your turn" flash is a direct response to a recorded control
        intent. Deferring only the state write preserves the timestamp while
        satisfying the same effect-state lint rule as the turn cue reset.
      */
      const timer = setTimeout(() => setNotTurnFlashAt(flashAt), 0);
      lastIntentRef.current = nextIntent;
      return () => clearTimeout(timer);
    }
    lastIntentRef.current = nextIntent;
    return undefined;
  }, [lastControlIntentAt, showNotTurnNotice]);

  useEffect(() => {
    if (!showNotTurnNotice || !notTurnFlashAt) return undefined;
    /*
      The flash has two timed edges: activate on the next task, then clear after
      the visible pulse duration. Owning both timers here keeps cleanup local
      when the user becomes operator or leaves the PTZ/rover turn surface.
    */
    const startTimer = setTimeout(() => setNoticeFlashActive(true), 0);
    const endTimer = setTimeout(() => setNoticeFlashActive(false), 650);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(endTimer);
    };
  }, [showNotTurnNotice, notTurnFlashAt]);

  return (
    <>
      {showTurnCue ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55">
          <div
            className={`flex flex-col items-center gap-0.5 rounded border border-amber-300/80 bg-black/70 ${cuePadClass}`}
          >
            <div className={`font-semibold text-amber-200 ${titleClass}`}>IT IS YOUR TURN!</div>
            <div className={`text-amber-200/80 ${subClass}`}>Start driving!</div>
            {showCountdown ? (
              <div className={`text-red-100/90 ${cueTimerClass}`}>
                Idle skip in {idleSkipSeconds}s
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {turnTimerText ? (
        <div
          className={`pointer-events-none absolute bottom-1 left-1 rounded border ${
            turnTimerFlashActive
              ? 'border-red-300/90 bg-red-900/80 text-red-100'
              : 'border-amber-300/80 bg-black/75 text-amber-200'
          } ${timerPadClass} ${timerTextClass}`}
        >
          {turnTimerText}
        </div>
      ) : null}

      {showNotTurnNotice ? (
        <div className="pointer-events-none absolute bottom-1 left-1 z-40">
          <div
            className={`w-fit rounded border ${
              noticeFlashActive
                ? 'border-red-300/90 bg-red-900/80 text-red-100'
                : 'border-amber-300/80 bg-black/75 text-amber-200'
            } ${mobileHud ? 'px-2 py-1 text-[0.6rem]' : 'px-3 py-1.5 text-sm'}`}
          >
            <div
              className={
                noticeFlashActive
                  ? 'text-[0.82rem] font-semibold text-red-50'
                  : 'text-[0.82rem] font-semibold text-white'
              }
            >
              Not your turn to drive!
            </div>
            {notTurnCountdownText ? (
              <div className={noticeFlashActive ? 'text-red-100/95' : 'text-amber-100'}>
                {notTurnCountdownText}
              </div>
            ) : null}
            {showPreviewReason ? (
              <div className={noticeFlashActive ? 'text-red-100/90' : 'text-amber-200/85'}>
                Video switched to preview mode to save bandwidth.
              </div>
            ) : null}
            <SocialButton
              id="discord"
              label="Join our Discord while you wait!"
              layout="inline"
              className="pointer-events-auto mt-0.5"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export default React.memo(TurnsOverlay);
