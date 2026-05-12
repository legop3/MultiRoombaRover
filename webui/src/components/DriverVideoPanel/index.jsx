// Driver Video Panel
// Purpose: Defines the Driver Video Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useTelemetryFrame } from '../../context/TelemetryContext.jsx';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../../hooks/useRoverSnapshots.js';
import { useControlSystem } from '../../controls/index.js';
import VideoTile from '../VideoTile/index.jsx';

function countEligibleDrivers(users = []) {
  const unique = new Set();
  users.forEach((entry) => {
    const role = String(entry?.role || '');
    if (role === 'spectator') return;
    const roverId = String(entry?.roverId || '').trim();
    const socketId = String(entry?.socketId || '').trim();
    if (!roverId || !socketId) return;
    unique.add(socketId);
  });
  return unique.size;
}

export default function DriverVideoPanel({ layoutFormat = 'desktop' }) {
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const users = useSessionSelector((state) => state.session?.users ?? []);
  const turnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const activeDrivers = useSessionSelector((state) => state.session?.activeDrivers ?? {});
  const {
    state: { song, lastControlIntentAt },
    overcurrentLimiter,
  } = useControlSystem();
  const [now, setNow] = useState(() => Date.now());
  const [turnCueVisible, setTurnCueVisible] = useState(false);
  const [turnCueStartAt, setTurnCueStartAt] = useState(null);
  const [notTurnFlashAt, setNotTurnFlashAt] = useState(0);
  const lastTurnRef = useRef({ initialized: false, roverId: null, activeDriverId: null });
  const lastIntentRef = useRef(lastControlIntentAt || 0);
  useEffect(() => {
    if (mode !== 'turns') {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [mode]);
  const rosterEntry =
    roverId && roster ? roster.find((item) => String(item.id) === String(roverId)) : null;
  const hasAudio = Boolean(rosterEntry?.media?.audioPublishUrl);
  const turnInfo = roverId ? turnQueues?.[roverId] : null;
  const activeDriverId = roverId ? activeDrivers?.[roverId] : null;
  const isActiveDriver = Boolean(socketId && activeDriverId === socketId);
  const nextDriverId = useMemo(() => {
    const queue = turnInfo?.queue || [];
    if (!queue.length || !turnInfo?.current || queue.length <= 1) return null;
    const idx = queue.findIndex((id) => id === turnInfo.current);
    if (idx === -1) {
      return queue[0] || null;
    }
    return queue[(idx + 1) % queue.length] || null;
  }, [turnInfo?.queue, turnInfo?.current]);
  const isNextDriver = Boolean(socketId && nextDriverId === socketId);
  const deadline = turnInfo?.deadline || null;
  const idleDeadline = turnInfo?.idleDeadline || null;
  const msUntilTurn = deadline ? deadline - now : null;
  const msUntilIdleSkip = idleDeadline ? idleDeadline - now : null;
  const isTurnsMode = mode === 'turns';
  const totalRovers = roster.length;
  const totalDrivers = useMemo(() => countEligibleDrivers(users), [users]);
  const shouldUsePreviewByLoad = isTurnsMode && totalDrivers > totalRovers;
  const isPreSwitchWindow = isTurnsMode && isNextDriver && msUntilTurn != null && msUntilTurn <= 5000 && msUntilTurn > 0;
  const isNotYourTurn = isTurnsMode && !isActiveDriver;
  const shouldUsePreview = isNotYourTurn && !isPreSwitchWindow && shouldUsePreviewByLoad;
  const shouldShowVideo = !shouldUsePreview;
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
    if (!isNotYourTurn || !isNextDriver || turnSeconds == null) return null;
    return `${turnSeconds} seconds until your turn.`;
  }, [isNotYourTurn, isNextDriver, turnSeconds]);
  const entries = roverId
    ? [
        ...(shouldShowVideo ? [{ type: 'rover', id: roverId, key: roverId }] : []),
        ...(hasAudio ? [{ type: 'rover', id: `${roverId}-audio`, key: `${roverId}-audio` }] : []),
      ]
    : [];
  const sources = useVideoRequests(entries);
  const info = roverId && shouldShowVideo ? sources[roverId] : null;
  const audioInfo = roverId && hasAudio ? sources[`${roverId}-audio`] : null;
  const snapshotFeeds = useRoverSnapshots(roverId ? [roverId] : [], {
    enabled: Boolean(roverId),
    version: mode,
  });
  const snapshotFeed = roverId ? snapshotFeeds[roverId] || null : null;
  const frame = useTelemetryFrame(roverId);
  const batteryRecord =
    roverId && roster
      ? roster.find((item) => String(item.id) === String(roverId))
      : null;
  const batteryConfig = batteryRecord?.battery ?? null;

  const roverLabel = batteryRecord?.name || (roverId ? `Rover ${roverId}` : '');

  useEffect(() => {
    if (mode !== 'turns') {
      setTurnCueVisible(false);
      setTurnCueStartAt(null);
      lastTurnRef.current = { initialized: false, roverId: null, activeDriverId: null };
      return;
    }
    const lastTurn = lastTurnRef.current;
    const nextActiveDriverId = activeDriverId || null;
    if (!socketId || !roverId) {
      setTurnCueVisible(false);
      setTurnCueStartAt(null);
      lastTurnRef.current = {
        initialized: false,
        roverId: null,
        activeDriverId: null,
      };
      return;
    }
    if (!lastTurn.initialized || lastTurn.roverId !== roverId) {
      lastTurnRef.current = {
        initialized: true,
        roverId,
        activeDriverId: nextActiveDriverId,
      };
      return;
    }
    const becameActive =
      Boolean(lastTurn.activeDriverId) &&
      lastTurn.activeDriverId !== socketId &&
      nextActiveDriverId === socketId;
    if (becameActive) {
      setTurnCueVisible(true);
      setTurnCueStartAt(Date.now());
    } else if (nextActiveDriverId !== socketId && turnCueVisible) {
      setTurnCueVisible(false);
      setTurnCueStartAt(null);
    }
    lastTurnRef.current = {
      initialized: true,
      roverId,
      activeDriverId: nextActiveDriverId,
    };
  }, [activeDriverId, mode, roverId, socketId, turnCueVisible]);

  useEffect(() => {
    if (!turnCueVisible || !turnCueStartAt) return;
    if (lastControlIntentAt > turnCueStartAt) {
      setTurnCueVisible(false);
    }
  }, [lastControlIntentAt, turnCueStartAt, turnCueVisible]);

  useEffect(() => {
    const lastIntent = Number(lastIntentRef.current) || 0;
    const nextIntent = Number(lastControlIntentAt) || 0;
    const advanced = nextIntent > lastIntent;
    if (advanced && isNotYourTurn) {
      setNotTurnFlashAt(Date.now());
    }
    lastIntentRef.current = nextIntent;
  }, [isNotYourTurn, lastControlIntentAt]);

  return (
    <section className="panel">
      {roverId ? (
        <VideoTile
          sessionInfo={info}
          videoMode={shouldShowVideo ? 'whep' : 'snapshot'}
          snapshotFeed={snapshotFeed}
          audioSessionInfo={audioInfo}
          label={roverLabel}
          roverColor={batteryRecord?.color || null}
          telemetryFrame={frame}
          batteryConfig={batteryConfig}
          layoutFormat={layoutFormat}
          overcurrentLimiter={overcurrentLimiter}
          songNote={song?.note}
          qualityNotice={null}
          showTurnCue={turnCueVisible}
          turnTimerText={turnTimerText}
          turnSeconds={turnSeconds}
          isActiveDriver={isActiveDriver}
          idleSkipSeconds={idleSkipSeconds}
          showNotTurnNotice={isNotYourTurn}
          notTurnCountdownText={notTurnCountdownText}
          showPreviewReason={shouldUsePreview}
          notTurnFlashAt={notTurnFlashAt}
        />
      ) : (
        <div className="panel-muted content-center text-center text-sm text-slate-400 aspect-[4/3]">
          <p>You are not assigned to a rover.</p>
          {/* colored button to visit the spectator page */}
          <p className="mt-0">
            <a href="/spectate" className="text-blue-400 underline hover:text-blue-500">
              Click here to visit the spectator page.
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
