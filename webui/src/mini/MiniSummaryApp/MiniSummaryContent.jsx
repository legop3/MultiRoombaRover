// Mini Summary Content
// Purpose: Defines the Mini Summary Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../context/SessionContext.jsx';
import { useVisualTelemetryFrames } from '../../context/TelemetryContext.jsx';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../../hooks/useRoverSnapshots.js';
import { useSpectatorMode } from '../../hooks/useSpectatorMode.js';
import useDefaultNickname from '../../hooks/useDefaultNickname.js';
import useUserIdentitySync from '../../hooks/useUserIdentitySync.js';
import PtzLiveVideo from '../../components/PtzLiveVideo/index.jsx';
import RoverMediaPlayer from '../../components/RoverMediaPlayer/index.jsx';
import FitViewportFrame from './components/FitViewportFrame.jsx';
import InfoColumn from './components/InfoColumn.jsx';
import { ROTATE_MS } from './constants.js';
import { formatDriverLabel } from './utils.js';

function hasRoverAudioCapture(rover) {
  // Mini uses the same media contract as the full rover player: audio exists
  // only when the nested microphone publisher block is enabled and publishable.
  return Boolean(rover?.media?.audioCapture?.enabled && rover?.media?.audioCapture?.publishUrl);
}

function AutoFitBoxText({ children, className = '', maxSize = 1000, minSize = 14 }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return undefined;

    let raf = null;
    const fit = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) {
        scheduleFit();
        return;
      }

      /*
        Unlike the shared AutoFitText helper, the PTZ operator label has a real
        second constraint: before rotation, text length must fit the screen
        height and text thickness must fit the blue column width. Binary search
        lets the name use as much of both dimensions as possible without
        clipping either after the 90-degree transform.
      */
      let low = minSize;
      let high = maxSize;
      let best = minSize;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        textEl.style.fontSize = `${mid}px`;
        const fits = textEl.scrollWidth <= width && textEl.scrollHeight <= height;
        if (fits) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      setFontSize(best);
    };

    const scheduleFit = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };

    scheduleFit();
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [children, maxSize, minSize]);

  return (
    <div ref={containerRef} className="flex h-full w-full min-w-0 items-center justify-center overflow-hidden">
      <div
        ref={textRef}
        className={`whitespace-nowrap ${className}`}
        style={{ fontSize: `${fontSize}px`, lineHeight: 1 }}
      >
        {children}
      </div>
    </div>
  );
}

function MiniPtzUserColumn({ label }) {
  const columnRef = useRef(null);
  const [columnSize, setColumnSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return undefined;

    const updateSize = () => {
      /*
        The label box is measured before rotation, so the blue column's screen
        height becomes the label's unrotated width, and the blue column's screen
        width becomes the label's unrotated height. That swapped geometry is the
        key difference from normal horizontal auto-fit text.
      */
      setColumnSize({
        width: column.clientWidth,
        height: column.clientHeight,
      });
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(column);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={columnRef} className="relative flex h-full w-full min-w-0 items-center justify-center overflow-hidden bg-sky-600 text-white">
      {/*
        The mini page is intended for glanceable room displays, so the PTZ user
        gets the same right-side identity treatment as rover metadata while
        letting the blue column absorb any extra horizontal room after the
        full-height PTZ video takes the camera-shaped part of the viewport.
      */}
      {columnSize.width > 16 && columnSize.height > 16 ? (
        <div
          className="absolute left-1/2 top-1/2 origin-center -translate-x-1/2 -translate-y-1/2 rotate-90 px-2 text-center leading-none"
          style={{
            width: `${columnSize.height - 16}px`,
            height: `${columnSize.width - 16}px`,
          }}
        >
          {/*
            This fitter checks both text width and text height before rotation.
            After rotation, that means the username fits both the vertical
            reading length and the visible thickness of the blue column.
          */}
          <AutoFitBoxText className="font-black leading-none text-white" maxSize={1000} minSize={16}>
            {label}
          </AutoFitBoxText>
        </div>
      ) : null}
    </div>
  );
}

export default function MiniSummaryContent() {
  const { session } = useSession();
  const spectatorReady = useSpectatorMode();
  useDefaultNickname();
  // Mini renders outside App.jsx, so it must run the same persisted identity
  // heartbeat itself. This keeps cookie-backed identity and saved nickname
  // metadata current without changing the mini page's layout or controls.
  useUserIdentitySync();
  const inLockdown = session?.mode === 'lockdown';
  const canSpectateVideo = Boolean(session?.isLocalNetwork);
  const frames = useVisualTelemetryFrames();
  const roster = session?.roster ?? [];
  const ptz = session?.ptzCamera || null;
  const ptzOperatorLabel = String(ptz?.operatorLabel || '').trim();
  const hasActivePtzOperator = Boolean(ptz?.enabled && ptzOperatorLabel);
  const [index, setIndex] = useState(0);
  const activeDrivers = session?.activeDrivers || {};
  const driverRoster = useMemo(
    () => roster.filter((rover) => activeDrivers[rover.id]),
    [roster, activeDrivers],
  );
  const mediaRovers = useMemo(
    () => roster.filter((rover) => rover?.id),
    [roster],
  );

  const snapshotFeeds = useRoverSnapshots(
    mediaRovers.map((rover) => rover.id),
    { enabled: !inLockdown && !canSpectateVideo, version: session?.mode },
  );
  const videoEntries = useMemo(
    () =>
      canSpectateVideo
        ? mediaRovers.map((rover) => ({ type: 'rover', id: rover.id, key: rover.id }))
        : [],
    [canSpectateVideo, mediaRovers],
  );
  const videoSources = useVideoRequests(videoEntries, {
    enabled: !inLockdown && canSpectateVideo,
    version: session?.mode,
  });
  const audioEntries = useMemo(
    () =>
      driverRoster.flatMap((rover) => {
        if (!rover?.id || !hasRoverAudioCapture(rover)) return [];
        const id = String(rover.id);
        return [{ type: 'rover', id: `${id}-audio`, key: `${id}-audio` }];
      }),
    [driverRoster],
  );
  const audioSources = useVideoRequests(audioEntries, { enabled: !inLockdown, version: session?.mode });

  const rotationPool = useMemo(() => {
    /*
      Rotation membership is intentionally based on human-controlled sources,
      not on WHEP response timing. The mounted media players below are a
      separate full-roster list, so a video token refresh, snapshot arrival, or
      active-driver update changes which already-warm layer is visible instead
      of tearing down the player components themselves.
    */
    const entries = driverRoster.map((rover) => ({ type: 'rover', rover }));
    if (hasActivePtzOperator) entries.push({ type: 'ptz' });
    return entries;
  }, [driverRoster, hasActivePtzOperator]);

  const rotationKey = useMemo(
    () =>
      rotationPool
        .map((entry) => (entry.type === 'ptz' ? 'p:ptz-camera' : `r:${entry.rover.id}`))
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
  const activePtz = activeEntry?.type === 'ptz';

  const activeVideo = canSpectateVideo && activeRover ? videoSources[activeRover.id] || null : null;
  const activeAudio = activeRover ? audioSources[`${activeRover.id}-audio`] || null : null;
  const activeFrame = activeRover ? frames[activeRover.id] || null : null;
  const driverLabel = activeRover ? formatDriverLabel({ roverId: activeRover.id, session }) : null;
  const showSideBySideFallback = !driverRoster.length && !hasActivePtzOperator;
  const hasMountedMediaSources = Boolean(mediaRovers.length || ptz?.enabled);

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
    <div className="relative flex h-screen w-screen overflow-hidden bg-black text-slate-100">
      {showSideBySideFallback ? (
        <section className="absolute inset-0 z-30 flex h-full w-full gap-x-3 bg-slate-900 px-0">
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
      ) : null}
      <section
        className={`relative flex h-full shrink-0 items-center justify-start overflow-hidden bg-black ${
          /*
            The no-driver view is still visually the old side-by-side roster,
            but keeping this carousel layer mounted behind it prevents every
            rover WHEP player from cold-starting when the first driver appears.
          */
          showSideBySideFallback ? 'opacity-0 pointer-events-none' : ''
        }`}
        style={{
          /*
            Rover cameras are framed by the existing 4:3 viewport helper below,
            but the PTZ camera is a 16:9 source. Give PTZ a 16:9 full-height
            media lane here so the actual camera image reaches the top and
            bottom of the screen, then let the right-side blue column consume
            whatever width remains.
          */
          width: activePtz ? 'min(100vw, calc(100vh * 16 / 9))' : 'min(100vw, calc(100vh * 4 / 3))',
        }}
      >
        {!spectatorReady ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            Switching to spectator…
          </div>
        ) : hasMountedMediaSources ? (
          <div className="relative h-full w-full overflow-hidden bg-black">
            {/*
              Keep every mini media source mounted while the carousel rotates.
              WHEP negotiation is the expensive part that caused the visible
              blank gap, so inactive sources are hidden with opacity instead of
              being removed from React's tree and forced to reconnect later.
            */}
            {mediaRovers.map((rover) => {
              const isActive = activeRover?.id === rover.id;
              return (
                <div
                  key={rover.id}
                  className={`absolute inset-0 ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                >
                  <FitViewportFrame>
                    {canSpectateVideo ? (
                      <RoverMediaPlayer
                        roverId={rover.id}
                        videoMode="whep"
                        snapshotFeed={null}
                        audioSessionInfo={isActive ? activeAudio : null}
                        forceMute={!isActive}
                        label={rover.name || rover.id}
                        sensors={frames[rover.id]?.sensors || null}
                      />
                    ) : (
                      <RoverMediaPlayer
                        sessionInfo={null}
                        videoMode="snapshot"
                        snapshotFeed={snapshotFeeds[rover.id] || null}
                        audioSessionInfo={isActive ? activeAudio : null}
                        forceMute={!isActive}
                        label={rover.name || rover.id}
                        sensors={frames[rover.id]?.sensors || null}
                      />
                    )}
                  </FitViewportFrame>
                </div>
              );
            })}
            {ptz?.enabled ? (
              <div className={`absolute inset-0 ${activePtz ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {/*
                  PTZ bypasses FitViewportFrame because that helper intentionally
                  enforces the rover camera's 4:3 shape. Keeping this component
                  mounted preserves the PTZ WHEP session across rover/PTZ
                  rotations while still letting the visible pane resize to 16:9
                  when PTZ becomes active.
                */}
                <PtzLiveVideo
                  enabled={!inLockdown}
                  startMuted
                  className="relative h-full w-full bg-black"
                  videoClassName="h-full w-full object-cover"
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            {driverRoster.length ? 'No sources available.' : 'No active drivers.'}
          </div>
        )}
      </section>
      <aside
        className={`flex h-full min-w-0 flex-1 flex-col border-l border-slate-800/60 bg-black ${
          showSideBySideFallback ? 'opacity-0 pointer-events-none' : ''
        }`}
      >
        {activePtz ? (
          <MiniPtzUserColumn label={ptzOperatorLabel} />
        ) : activeRover ? (
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
