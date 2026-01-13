import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../hooks/useRoverSnapshots.js';
import { useControlSystem } from '../controls/index.js';
import VideoTile from './VideoTile.jsx';

export default function DriverVideoPanel({layoutFormat = 'desktop'}) {
  const { session } = useSession();
  const {
    state: { song },
  } = useControlSystem();
  const [now, setNow] = useState(() => Date.now());
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
  const msUntilTurn = deadline ? deadline - now : null;
  const isPreSwitchWindow =
    session?.mode === 'turns' && isNextDriver && msUntilTurn != null && msUntilTurn <= 5000 && msUntilTurn > 0;
  const shouldShowVideo = session?.mode !== 'turns' || isActiveDriver || isPreSwitchWindow;
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
        />
      ) : (
        <div className="panel-muted content-center text-center text-sm text-slate-400 aspect-video">
          <p>You are not assigned to a rover.</p>
          {/* colored button to visit the spectator page */}
          <p className="mt-2">
            <a href="/spectate" className="text-blue-400 underline hover:text-blue-500">
              Click here to visit the spectator page.
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
