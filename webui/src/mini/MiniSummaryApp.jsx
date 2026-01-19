import { useEffect, useMemo, useState } from 'react';
import { SettingsProvider } from '../settings/index.js';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrames } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../hooks/useRoverSnapshots.js';
import { useSpectatorMode } from '../hooks/useSpectatorMode.js';
import VideoTile from '../components/VideoTile.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import AlertFeed from '../components/AlertFeed.jsx';
import useDefaultNickname from '../hooks/useDefaultNickname.js';

const ROTATE_MS = 20000;
const HARD_REFRESH_MS = 3 * 60 * 60 * 1000;

function formatDriverLabel({ roverId, session }) {
  const activeDriverId = session?.activeDrivers?.[roverId] || null;
  const user = (session?.users || []).find((entry) => entry.socketId === activeDriverId);
  const label = user?.nickname || (activeDriverId ? activeDriverId.slice(0, 6) : 'No driver');
  const mode = session?.mode;
  const turnInfo = session?.turnQueues?.[roverId];
  return mode === 'turns' && turnInfo?.current ? `${label} (turns)` : label;
}

function MiniSummaryContent() {
  const { session } = useSession();
  const spectatorReady = useSpectatorMode();
  useDefaultNickname();
  const inLockdown = session?.mode === 'lockdown';
  const frames = useTelemetryFrames();
  const roster = session?.roster ?? [];
  const [index, setIndex] = useState(0);
  const activeDrivers = session?.activeDrivers || {};
  const driverRoster = useMemo(
    () => roster.filter((rover) => activeDrivers[rover.id]),
    [roster, activeDrivers],
  );

  const snapshotFeeds = useRoverSnapshots(
    driverRoster.map((rover) => rover.id),
    { enabled: !inLockdown, version: session?.mode },
  );
  const audioEntries = useMemo(
    () =>
      driverRoster.flatMap((rover) => {
        if (!rover?.id || !rover.media?.audioPublishUrl) return [];
        const id = String(rover.id);
        return [{ type: 'rover', id: `${id}-audio`, key: `${id}-audio` }];
      }),
    [driverRoster],
  );
  const audioSources = useVideoRequests(audioEntries, { enabled: !inLockdown, version: session?.mode });

  const roverPool = useMemo(() => {
    if (!driverRoster.length) return [];
    const withSnapshot = driverRoster.filter((rover) => snapshotFeeds[rover.id]?.objectUrl);
    return withSnapshot.length ? withSnapshot : driverRoster;
  }, [driverRoster, snapshotFeeds]);

  const rotationPool = useMemo(() => {
    return roverPool.map((rover) => ({ type: 'rover', rover }));
  }, [roverPool]);

  const rotationKey = useMemo(
    () =>
      rotationPool
        .map((entry) => `r:${entry.rover.id}`)
        .join('|'),
    [rotationPool],
  );

  useEffect(() => {
    setIndex(0);
  }, [rotationKey]);

  useEffect(() => {
    if (!rotationPool.length) return undefined;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % rotationPool.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotationPool.length, rotationKey]);

  const activeEntry = rotationPool.length ? rotationPool[index % rotationPool.length] : null;
  const activeRover = activeEntry?.type === 'rover' ? activeEntry.rover : null;

  const activeSnapshot = activeRover ? snapshotFeeds[activeRover.id] || null : null;
  const activeAudio = activeRover ? audioSources[`${activeRover.id}-audio`] || null : null;
  const activeFrame = activeRover ? frames[activeRover.id] || null : null;
  const driverLabel = activeRover ? formatDriverLabel({ roverId: activeRover.id, session }) : null;

  if (inLockdown) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-black text-slate-200">
        <div className="surface max-w-sm space-y-0.5 p-1 text-center text-sm">
          <p className="text-lg font-semibold text-white">Mini spectator is disabled in lockdown.</p>
          <p className="text-slate-300">It will automatically resume once lockdown ends.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black p-0.5 text-slate-100 flex flex-col gap-0.5">
      <ChatOverlay />
      <section className="panel relative flex min-h-0 flex-1 overflow-hidden">
        {!spectatorReady ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            Switching to spectator…
          </div>
        ) : activeRover ? (
          <FitViewportFrame>
            <VideoTile
              sessionInfo={null}
              videoMode="snapshot"
              snapshotFeed={activeSnapshot}
              audioSessionInfo={activeAudio}
              label={activeRover.name || activeRover.id}
              telemetryFrame={activeFrame}
              batteryConfig={activeRover.battery}
              layoutFormat="mobile"
              hudVariant="spectator"
              driverLabel={driverLabel}
              hudLabelScale={5}
              hudForceMap
              hudMapPosition="bottom-left"
              fitParent
            />
          </FitViewportFrame>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            {driverRoster.length ? 'No sources available.' : 'No active drivers.'}
          </div>
        )}
      </section>
    </div>
  );
}

export default function MiniSummaryApp() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('refresh', Date.now().toString());
      window.location.replace(url.toString());
    }, HARD_REFRESH_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SettingsProvider>
      <>
        <MiniSummaryContent />
        <AlertFeed scale={3} />
      </>
    </SettingsProvider>
  );
}

function ChatOverlay() {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1 z-30"
      style={{ transform: 'translate(-50%, 0) scale(0.7)', transformOrigin: 'top center' }}
    >
      <div
        className="pointer-events-none overflow-hidden rounded-md"
        style={{ width: '50vw', minWidth: '16rem', maxWidth: '24rem', opacity: 0.55, maxHeight: '12rem' }}
      >
        <ChatPanel hideInput hideSpectatorNotice />
      </div>
    </div>
  );
}

function FitViewportFrame({ children }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <div
        className="relative flex items-center justify-center overflow-hidden bg-black"
        style={{
          width: 'min(100%, calc(100vh * 4 / 3))',
          height: 'min(100%, calc(100vw * 3 / 4))',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: '4 / 3',
        }}
      >
        <div className="flex h-full w-full items-center justify-center overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
