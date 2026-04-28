// Mini Summary Content
// Purpose: Defines the Mini Summary Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../context/SessionContext.jsx';
import { useTelemetryFrames } from '../../context/TelemetryContext.jsx';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../../hooks/useRoverSnapshots.js';
import { useSpectatorMode } from '../../hooks/useSpectatorMode.js';
import useDefaultNickname from '../../hooks/useDefaultNickname.js';
import VideoTile from '../../components/VideoTile/index.jsx';
import FitViewportFrame from './components/FitViewportFrame.jsx';
import InfoColumn from './components/InfoColumn.jsx';
import { ROTATE_MS } from './constants.js';
import { formatDriverLabel } from './utils.js';

export default function MiniSummaryContent() {
  const { session } = useSession();
  const spectatorReady = useSpectatorMode();
  useDefaultNickname();
  const inLockdown = session?.mode === 'lockdown';
  const canSpectateVideo = Boolean(session?.isLocalNetwork);
  const frames = useTelemetryFrames();
  const roster = session?.roster ?? [];
  const [index, setIndex] = useState(0);
  const activeDrivers = session?.activeDrivers || {};
  const driverRoster = useMemo(
    () => roster.filter((rover) => activeDrivers[rover.id]),
    [roster, activeDrivers],
  );
  const snapshotRoster = driverRoster.length ? driverRoster : roster;

  const snapshotFeeds = useRoverSnapshots(
    snapshotRoster.map((rover) => rover.id),
    { enabled: !inLockdown && !canSpectateVideo, version: session?.mode },
  );
  const videoEntries = useMemo(
    () =>
      canSpectateVideo
        ? snapshotRoster.map((rover) => ({ type: 'rover', id: rover.id, key: rover.id }))
        : [],
    [canSpectateVideo, snapshotRoster],
  );
  const videoSources = useVideoRequests(videoEntries, {
    enabled: !inLockdown && canSpectateVideo,
    version: session?.mode,
  });
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
    if (!canSpectateVideo) {
      const withSnapshot = driverRoster.filter((rover) => snapshotFeeds[rover.id]?.objectUrl);
      return withSnapshot.length ? withSnapshot : driverRoster;
    }
    const withVideo = driverRoster.filter((rover) => {
      const sessionInfo = videoSources[rover.id];
      return sessionInfo?.url && !sessionInfo?.error;
    });
    return withVideo.length ? withVideo : driverRoster;
  }, [driverRoster, snapshotFeeds, videoSources, canSpectateVideo]);

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

  const activeSnapshot = !canSpectateVideo && activeRover ? snapshotFeeds[activeRover.id] || null : null;
  const activeVideo = canSpectateVideo && activeRover ? videoSources[activeRover.id] || null : null;
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

  if (!driverRoster.length) {
    return (
      <div className="relative flex h-screen w-screen overflow-hidden bg-black text-slate-100">
        <section className="flex h-full w-full gap-x-3 bg-slate-900 px-0">
          {roster.length ? (
            roster.map((rover) => (
              <InfoColumn
                key={rover.id}
                rover={rover}
                frame={frames[rover.id] || null}
                driverLabel={null}
                sessionInfo={canSpectateVideo ? videoSources[rover.id] || null : null}
                videoMode={canSpectateVideo ? 'whep' : 'snapshot'}
                snapshotFeed={canSpectateVideo ? null : snapshotFeeds[rover.id] || null}
                showPreview={true}
                withDivider={false}
              />
            ))
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
              No rovers available.
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-black text-slate-100">
      <section
        className="relative flex h-full shrink-0 items-center justify-start overflow-hidden bg-black"
        style={{ width: 'min(100vw, calc(100vh * 4 / 3))' }}
      >
        {!spectatorReady ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            Switching to spectator…
          </div>
        ) : activeRover ? (
          <FitViewportFrame>
            {canSpectateVideo ? (
              <div className="relative h-full w-full">
                {rotationPool.map((entry) => {
                  const rover = entry.rover;
                  const isActive = activeRover?.id === rover.id;
                  return (
                    <div
                      key={rover.id}
                      className={`absolute inset-0 ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    >
                      <VideoTile
                        sessionInfo={videoSources[rover.id] || null}
                        videoMode="whep"
                        snapshotFeed={null}
                        audioSessionInfo={isActive ? activeAudio : null}
                        forceMute={!isActive}
                        label={rover.name || rover.id}
                        roverColor={rover.color || null}
                        telemetryFrame={frames[rover.id] || null}
                        batteryConfig={rover.battery}
                        layoutFormat="mobile"
                        hudVariant="none"
                        fitParent
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <VideoTile
                sessionInfo={null}
                videoMode="snapshot"
                snapshotFeed={activeSnapshot}
                audioSessionInfo={activeAudio}
                label={activeRover.name || activeRover.id}
                roverColor={activeRover.color || null}
                telemetryFrame={activeFrame}
                batteryConfig={activeRover.battery}
                layoutFormat="mobile"
                hudVariant="none"
                fitParent
              />
            )}
          </FitViewportFrame>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            {driverRoster.length ? 'No sources available.' : 'No active drivers.'}
          </div>
        )}
      </section>
      <aside className="flex h-full min-w-0 flex-1 flex-col border-l border-slate-800/60 bg-black">
        {activeRover ? (
          <InfoColumn
            rover={activeRover}
            frame={activeFrame}
            driverLabel={driverLabel}
            sessionInfo={canSpectateVideo ? activeVideo : null}
            videoMode={canSpectateVideo ? 'whep' : 'snapshot'}
            snapshotFeed={canSpectateVideo ? null : snapshotFeeds[activeRover.id] || null}
            showPreview={false}
            variant="active"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            No active rover.
          </div>
        )}
      </aside>
    </div>
  );
}
