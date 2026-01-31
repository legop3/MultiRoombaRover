import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SettingsProvider } from '../settings/index.js';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrames } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../hooks/useRoverSnapshots.js';
import { useSpectatorMode } from '../hooks/useSpectatorMode.js';
import VideoTile from '../components/VideoTile.jsx';
import TopDownMap from '../components/TopDownMap.jsx';
import AlertFeed from '../components/AlertFeed.jsx';
import useDefaultNickname from '../hooks/useDefaultNickname.js';

const ROTATE_MS = 20000;
const PREWARM_MS = 5000;
const HARD_REFRESH_MS = 3 * 60 * 60 * 1000;

function formatDriverLabel({ roverId, session }) {
  const activeDriverId = session?.activeDrivers?.[roverId] || null;
  const user = (session?.users || []).find((entry) => entry.socketId === activeDriverId);
  const label = user?.nickname || (activeDriverId ? activeDriverId.slice(0, 6) : 'No driver');
  const mode = session?.mode;
  const turnInfo = session?.turnQueues?.[roverId];
  return mode === 'turns' && turnInfo?.current ? `${label}` : label;
}

function getBatteryPercent({ rover, frame }) {
  const percentDisplay = rover?.batteryState?.percentDisplay;
  if (percentDisplay != null && Number.isFinite(percentDisplay)) {
    return Math.round(percentDisplay);
  }
  const config = rover?.battery ?? null;
  const charge = frame?.sensors?.batteryChargeMah ?? null;
  const full = config?.Full ?? null;
  const warn = config?.Warn ?? null;
  if (charge == null || full == null || warn == null) return null;
  const span = full - warn;
  if (span <= 0) return null;
  const normalized = (charge - warn) / span;
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100);
}

function getBatteryFillClass({ rover }) {
  const urgentActive = rover?.batteryState?.urgentActive ?? false;
  const warnActive = rover?.batteryState?.warnActive ?? false;
  if (urgentActive) return 'bg-red-500/40';
  if (warnActive) return 'bg-amber-400/40';
  return 'bg-emerald-400/40';
}

function InfoColumn({
  rover,
  frame,
  driverLabel,
  sessionInfo,
  videoMode = 'snapshot',
  snapshotFeed,
  withDivider = false,
  showPreview = true,
  variant = 'stacked',
}) {
  const batteryPercent = getBatteryPercent({ rover, frame });
  const batteryFillClass = getBatteryFillClass({ rover });
  const isActiveView = variant === 'active';
  const batteryFillStyle = isActiveView
    ? { height: `${batteryPercent == null ? 0 : batteryPercent}%`, bottom: 0, top: 'auto' }
    : { width: `${batteryPercent == null ? 0 : batteryPercent}%` };
  const batteryFillClassName = isActiveView
    ? `pointer-events-none absolute bottom-0 left-0 right-0 ${batteryFillClass}`
    : `pointer-events-none absolute left-0 top-0 bottom-0 ${batteryFillClass}`;
  return (
    <div
      className={`relative flex min-w-0 flex-1 flex-col gap-4 overflow-hidden bg-black px-0 py-0 ${
        withDivider ? 'border-r border-slate-700/60' : ''
      }`}
    >
      <div className={batteryFillClassName} style={batteryFillStyle} />
      {isActiveView ? (
        <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between text-center">
          <div className="min-w-0 bg-transparent px-0 py-0 leading-none">
            <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={18}>
              {rover.name || rover.id}
            </AutoFitText>
          </div>
          {driverLabel ? (
            <div className="min-w-0 bg-transparent px-0 py-0 leading-none">
              <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={16}>
                {driverLabel}
              </AutoFitText>
            </div>
          ) : (
            <div />
          )}
          <div className="relative min-w-0 overflow-hidden bg-transparent px-0 py-0 leading-none">
            <div className="relative">
              <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={16}>
                {batteryPercent == null ? '--%' : `${batteryPercent}%`}
              </AutoFitText>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative z-10 flex min-w-0 flex-col gap-1 text-center">
            <div className="min-w-0 bg-transparent px-0 py-0 leading-none">
              <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={18}>
                {rover.name || rover.id}
              </AutoFitText>
            </div>
            {driverLabel ? (
              <div className="min-w-0 bg-transparent px-0 py-0 leading-none">
                <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={16}>
                  {driverLabel}
                </AutoFitText>
              </div>
            ) : null}
            <div className="relative min-w-0 overflow-hidden bg-transparent px-0 py-0 leading-none">
              <div className="relative">
                <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={16}>
                  {batteryPercent == null ? '--%' : `${batteryPercent}%`}
                </AutoFitText>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex w-full min-w-0 flex-1 flex-col items-center gap-4">
              {showPreview ? (
                <div className="mt-auto w-full">
                  <div className="w-full aspect-[4/3]">
                    <VideoTile
                      sessionInfo={sessionInfo}
                      videoMode={videoMode}
                      snapshotFeed={snapshotFeed}
                      audioSessionInfo={null}
                      label={rover.name || rover.id}
                      telemetryFrame={frame}
                      batteryConfig={rover.battery}
                      layoutFormat="mobile"
                      hudVariant="none"
                      fitParent
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AutoFitText({ children, className = '', maxSize = 1000, minSize = 14 }) {
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
      if (!width) {
        scheduleFit();
        return;
      }
      let low = minSize;
      let high = maxSize;
      let best = minSize;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        textEl.style.fontSize = `${mid}px`;
        const fits = textEl.scrollWidth <= width;
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
    <div ref={containerRef} className="w-full min-w-0">
      <div
        ref={textRef}
        className={`whitespace-nowrap ${className}`}
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.1 }}
      >
        {children}
      </div>
    </div>
  );
}

function MiniSummaryContent() {
  const { session } = useSession();
  const spectatorReady = useSpectatorMode();
  useDefaultNickname();
  const inLockdown = session?.mode === 'lockdown';
  const canSpectateVideo = Boolean(session?.isLocalNetwork);
  const frames = useTelemetryFrames();
  const roster = session?.roster ?? [];
  const [index, setIndex] = useState(0);
  const [prewarmRoverId, setPrewarmRoverId] = useState(null);
  const prewarmTimer = useRef(null);
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
  const videoSources = useVideoRequests(videoEntries, { enabled: !inLockdown && canSpectateVideo, version: session?.mode });
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

  useEffect(() => {
    setPrewarmRoverId(null);
  }, [rotationKey]);

  useEffect(() => {
    clearTimeout(prewarmTimer.current);
    if (!canSpectateVideo || rotationPool.length < 2) {
      setPrewarmRoverId(null);
      return undefined;
    }
    const nextIndex = (index + 1) % rotationPool.length;
    const delay = Math.max(0, ROTATE_MS - PREWARM_MS);
    prewarmTimer.current = setTimeout(() => {
      const nextEntry = rotationPool[nextIndex];
      setPrewarmRoverId(nextEntry?.rover?.id || null);
    }, delay);
    return () => clearTimeout(prewarmTimer.current);
  }, [index, rotationPool, canSpectateVideo]);

  const activeEntry = rotationPool.length ? rotationPool[index % rotationPool.length] : null;
  const activeRover = activeEntry?.type === 'rover' ? activeEntry.rover : null;
  const prewarmRover = prewarmRoverId
    ? rotationPool.find((entry) => entry.rover?.id === prewarmRoverId)?.rover || null
    : null;

  const activeSnapshot = !canSpectateVideo && activeRover ? snapshotFeeds[activeRover.id] || null : null;
  const activeVideo = canSpectateVideo && activeRover ? videoSources[activeRover.id] || null : null;
  const prewarmVideo = canSpectateVideo && prewarmRover ? videoSources[prewarmRover.id] || null : null;
  const activeAudio = activeRover ? audioSources[`${activeRover.id}-audio`] || null : null;
  const activeFrame = activeRover ? frames[activeRover.id] || null : null;
  const prewarmFrame = prewarmRover ? frames[prewarmRover.id] || null : null;
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
        <section className="flex h-full w-full gap-x-1">
          {roster.length ? (
            roster.map((rover, idx) => (
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
                <div className="absolute inset-0">
                  <VideoTile
                    sessionInfo={activeVideo}
                    videoMode="whep"
                    snapshotFeed={null}
                    audioSessionInfo={activeAudio}
                    label={activeRover.name || activeRover.id}
                    telemetryFrame={activeFrame}
                    batteryConfig={activeRover.battery}
                    layoutFormat="mobile"
                    hudVariant="none"
                    fitParent
                  />
                </div>
                {prewarmRover && prewarmRover.id !== activeRover.id ? (
                  <div className="absolute inset-0 opacity-0 pointer-events-none">
                    <VideoTile
                      sessionInfo={prewarmVideo}
                      videoMode="whep"
                      snapshotFeed={null}
                      audioSessionInfo={null}
                      forceMute
                      label={prewarmRover.name || prewarmRover.id}
                      telemetryFrame={prewarmFrame}
                      batteryConfig={prewarmRover.battery}
                      layoutFormat="mobile"
                      hudVariant="none"
                      fitParent
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <VideoTile
                sessionInfo={null}
                videoMode="snapshot"
                snapshotFeed={activeSnapshot}
                audioSessionInfo={activeAudio}
                label={activeRover.name || activeRover.id}
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

function FitViewportFrame({ children }) {
  return (
    <div className="flex h-full w-full items-center justify-start overflow-hidden bg-black">
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
