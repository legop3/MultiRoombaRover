import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useControlSelector } from '../../../controls/index.js';
import SocialButton from '../../SocialButton/index.jsx';

function TurnsOverlay({
  roverId = null,
  mobileHud = false,
}) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const users = useSessionSelector((state) => state.session?.users ?? []);
  const turnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const activeDrivers = useSessionSelector((state) => state.session?.activeDrivers ?? {});
  const lastControlIntentAt = useControlSelector((control) => control.state.lastControlIntentAt);
  const [now, setNow] = useState(() => Date.now());
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
  const turnInfo = effectiveRoverId ? turnQueues?.[effectiveRoverId] : null;
  const activeDriverId = effectiveRoverId ? activeDrivers?.[effectiveRoverId] : null;
  const isActiveDriver = Boolean(socketId && activeDriverId === socketId);
  const nextDriverId = useMemo(() => {
    const queue = turnInfo?.queue || [];
    if (!queue.length || !turnInfo?.current || queue.length <= 1) return null;
    const idx = queue.findIndex((id) => id === turnInfo.current);
    if (idx === -1) return queue[0] || null;
    return queue[(idx + 1) % queue.length] || null;
  }, [turnInfo?.queue, turnInfo?.current]);
  const isNextDriver = Boolean(socketId && nextDriverId === socketId);
  const deadline = turnInfo?.deadline || null;
  const idleDeadline = turnInfo?.idleDeadline || null;
  const msUntilTurn = deadline ? deadline - now : null;
  const msUntilIdleSkip = idleDeadline ? idleDeadline - now : null;
  const isTurnsMode = mode === 'turns';
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
  const shouldUsePreviewByLoad = isTurnsMode && totalDrivers > totalRovers;
  const isPreSwitchWindow =
    isTurnsMode && isNextDriver && msUntilTurn != null && msUntilTurn <= 5000 && msUntilTurn > 0;
  const showNotTurnNotice = isTurnsMode && !isActiveDriver;
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
    if (mode !== 'turns') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'turns') {
      setShowTurnCue(false);
      setTurnCueStartAt(null);
      lastTurnRef.current = { initialized: false, roverId: null, activeDriverId: null };
      return;
    }
    const lastTurn = lastTurnRef.current;
    const nextActiveDriverId = activeDriverId || null;
    if (!socketId || !effectiveRoverId) {
      setShowTurnCue(false);
      setTurnCueStartAt(null);
      lastTurnRef.current = { initialized: false, roverId: null, activeDriverId: null };
      return;
    }
    if (!lastTurn.initialized || lastTurn.roverId !== effectiveRoverId) {
      lastTurnRef.current = { initialized: true, roverId: effectiveRoverId, activeDriverId: nextActiveDriverId };
      return;
    }
    const becameActive =
      Boolean(lastTurn.activeDriverId) &&
      lastTurn.activeDriverId !== socketId &&
      nextActiveDriverId === socketId;
    if (becameActive) {
      setShowTurnCue(true);
      setTurnCueStartAt(Date.now());
    } else if (nextActiveDriverId !== socketId && showTurnCue) {
      setShowTurnCue(false);
      setTurnCueStartAt(null);
    }
    lastTurnRef.current = { initialized: true, roverId: effectiveRoverId, activeDriverId: nextActiveDriverId };
  }, [activeDriverId, mode, effectiveRoverId, socketId, showTurnCue]);

  useEffect(() => {
    if (!showTurnCue || !turnCueStartAt) return;
    if (lastControlIntentAt > turnCueStartAt) {
      setShowTurnCue(false);
    }
  }, [lastControlIntentAt, showTurnCue, turnCueStartAt]);

  useEffect(() => {
    const lastIntent = Number(lastIntentRef.current) || 0;
    const nextIntent = Number(lastControlIntentAt) || 0;
    if (nextIntent > lastIntent && showNotTurnNotice) {
      setNotTurnFlashAt(Date.now());
    }
    lastIntentRef.current = nextIntent;
  }, [lastControlIntentAt, showNotTurnNotice]);

  useEffect(() => {
    if (!showNotTurnNotice || !notTurnFlashAt) return undefined;
    setNoticeFlashActive(true);
    const timer = setTimeout(() => setNoticeFlashActive(false), 650);
    return () => clearTimeout(timer);
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
            <div className="pointer-events-auto mt-0.5">
              <SocialButton id="discord" label="Join our Discord while you wait!" layout='inline'/>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default React.memo(TurnsOverlay);
