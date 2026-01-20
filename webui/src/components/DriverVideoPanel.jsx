import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../hooks/useRoverSnapshots.js';
import { useControlSystem } from '../controls/index.js';
import VideoTile from './VideoTile.jsx';

export default function DriverVideoPanel({layoutFormat = 'desktop'}) {
  const { session } = useSession();
  const {
    state: { song, lastControlIntentAt },
  } = useControlSystem();
  const [now, setNow] = useState(() => Date.now());
  const [turnCueVisible, setTurnCueVisible] = useState(false);
  const [turnCueStartAt, setTurnCueStartAt] = useState(null);
  const lastTurnRef = useRef({ active: false, roverId: null });
  useEffect(() => {
    if (session?.mode !== 'turns') {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [session?.mode]);
  const roverId = session?.assignment?.roverId;
  const rosterEntry =
    roverId && session?.roster ? session.roster.find((item) => String(item.id) === String(roverId)) : null;
  const hasAudio = Boolean(rosterEntry?.media?.audioPublishUrl);
  const turnInfo = roverId ? session?.turnQueues?.[roverId] : null;
  const socketId = session?.socketId || null;
  const activeDriverId = roverId ? session?.activeDrivers?.[roverId] : null;
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
  const isPreSwitchWindow =
    session?.mode === 'turns' && isNextDriver && msUntilTurn != null && msUntilTurn <= 5000 && msUntilTurn > 0;
  const shouldShowVideo = session?.mode !== 'turns' || isActiveDriver || isPreSwitchWindow;
  const turnSeconds =
    msUntilTurn != null && Number.isFinite(msUntilTurn) ? Math.max(0, Math.ceil(msUntilTurn / 1000)) : null;
  const idleSkipSeconds =
    msUntilIdleSkip != null && Number.isFinite(msUntilIdleSkip)
      ? Math.max(0, Math.ceil(msUntilIdleSkip / 1000))
      : null;
  const turnTimerText = isActiveDriver
    ? turnSeconds != null
      ? `${turnSeconds}s left`
      : null
    : isNextDriver && turnSeconds != null
    ? `Your turn in ${turnSeconds}s`
    : null;
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
    version: session?.mode,
  });
  const snapshotFeed = roverId ? snapshotFeeds[roverId] || null : null;
  const frame = useTelemetryFrame(roverId);
  const batteryRecord =
    roverId && session?.roster
      ? session.roster.find((item) => String(item.id) === String(roverId))
      : null;
  const batteryConfig = batteryRecord?.battery ?? null;

  const roverLabel = batteryRecord?.name || (roverId ? `Rover ${roverId}` : '');

  useEffect(() => {
    if (session?.mode !== 'turns') {
      setTurnCueVisible(false);
      setTurnCueStartAt(null);
      lastTurnRef.current = { active: false, roverId: null };
      return;
    }
    const lastTurn = lastTurnRef.current;
    const becameActive = isActiveDriver && !lastTurn.active;
    const roverChanged = isActiveDriver && roverId && roverId !== lastTurn.roverId;
    if (becameActive || roverChanged) {
      setTurnCueVisible(true);
      setTurnCueStartAt(Date.now());
    } else if (!isActiveDriver && lastTurn.active) {
      setTurnCueVisible(false);
      setTurnCueStartAt(null);
    }
    lastTurnRef.current = { active: isActiveDriver, roverId };
  }, [isActiveDriver, roverId, session?.mode]);

  useEffect(() => {
    if (!turnCueVisible || !turnCueStartAt) return;
    if (lastControlIntentAt > turnCueStartAt) {
      setTurnCueVisible(false);
    }
  }, [lastControlIntentAt, turnCueStartAt, turnCueVisible]);

  return (
    <section className="panel">
      {roverId ? (
        <VideoTile
          sessionInfo={info}
          videoMode={shouldShowVideo ? 'whep' : 'snapshot'}
          snapshotFeed={snapshotFeed}
          audioSessionInfo={audioInfo}
          label={roverLabel}
          telemetryFrame={frame}
          batteryConfig={batteryConfig}
          layoutFormat={layoutFormat}
          songNote={song?.note}
          qualityNotice={!shouldShowVideo ? 'Preview feed (low FPS) until your turn.' : null}
          showTurnCue={turnCueVisible}
          turnTimerText={turnTimerText}
          turnSeconds={turnSeconds}
          isActiveDriver={isActiveDriver}
          idleSkipSeconds={idleSkipSeconds}
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
