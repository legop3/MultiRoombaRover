import { useEffect, useMemo, useState } from 'react';
import { SettingsProvider } from '../settings/index.js';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrames } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import { useSpectatorMode } from '../hooks/useSpectatorMode.js';
import { useRoomCameraSnapshots } from '../hooks/useRoomCameraSnapshots.js';
import VideoTile from '../components/VideoTile.jsx';
import ChatPanel from '../components/ChatPanel.jsx';

const ROTATE_MS = 20000;

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
  const frames = useTelemetryFrames();
  const roster = session?.roster ?? [];
  const roomCameras = session?.roomCameras || [];
  const feeds = useRoomCameraSnapshots(roomCameras.map((camera) => ({ id: camera.id })));
  const [index, setIndex] = useState(0);

  const entries = useMemo(
    () =>
      roster.flatMap((rover) => {
        if (!rover?.id) return [];
        const id = String(rover.id);
        const base = [{ type: 'rover', id, key: id }];
        if (rover.media?.audioPublishUrl) {
          base.push({ type: 'rover', id: `${id}-audio`, key: `${id}-audio` });
        }
        return base;
      }),
    [roster],
  );

  const videoSources = useVideoRequests(entries);

  const roverPool = useMemo(() => {
    if (!roster.length) return [];
    const withVideo = roster.filter((rover) => videoSources[rover.id]?.url);
    return withVideo.length ? withVideo : roster;
  }, [roster, videoSources]);

  const rotationPool = useMemo(() => {
    const items = [];
    roverPool.forEach((rover) => items.push({ type: 'rover', rover }));
    roomCameras.forEach((camera) => items.push({ type: 'room', camera }));
    return items;
  }, [roverPool, roomCameras]);

  const rotationKey = useMemo(
    () =>
      rotationPool
        .map((entry) =>
          entry.type === 'rover' ? `r:${entry.rover.id}` : `room:${entry.camera.id}`,
        )
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
  const activeCamera = activeEntry?.type === 'room' ? activeEntry.camera : null;

  const activeVideo = activeRover ? videoSources[activeRover.id] || null : null;
  const activeAudio = activeRover ? videoSources[`${activeRover.id}-audio`] || null : null;
  const activeFrame = activeRover ? frames[activeRover.id] || null : null;
  const driverLabel = activeRover ? formatDriverLabel({ roverId: activeRover.id, session }) : null;
  const activeFeed = activeCamera ? feeds[activeCamera.id] || null : null;

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
              sessionInfo={activeVideo}
              audioSessionInfo={activeAudio}
              label={activeRover.name || activeRover.id}
              telemetryFrame={activeFrame}
              batteryConfig={activeRover.battery}
              layoutFormat="mobile"
              hudVariant="spectator"
              driverLabel={driverLabel}
              hudForceMap
              hudMapPosition="bottom-left"
            />
          </FitViewportFrame>
        ) : activeCamera ? (
          <FitViewportFrame>
            <RoomCameraFrame camera={activeCamera} feed={activeFeed} />
          </FitViewportFrame>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            No sources available.
          </div>
        )}
      </section>
    </div>
  );
}

export default function MiniSummaryApp() {
  return (
    <SettingsProvider>
      <MiniSummaryContent />
    </SettingsProvider>
  );
}

function RoomCameraFrame({ camera, feed }) {
  const hasImage = feed?.objectUrl;
  const connecting = feed && feed.status === 'connecting';
  return (
    <div className="relative h-full w-full bg-zinc-950">
      {hasImage ? (
        <img
          src={feed.objectUrl}
          alt={camera.name || camera.id}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
          {connecting ? `Connecting to ${camera.name || camera.id}…` : 'No frame yet'}
        </div>
      )}
      <div className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.25 text-xs text-slate-200">
        {camera.name || camera.id}
      </div>
    </div>
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
          width: 'min(100%, calc(100vh * 16 / 9))',
          height: 'min(100%, calc(100vw * 9 / 16))',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: '16 / 9',
        }}
      >
        <div className="flex h-full w-full items-center justify-center overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
