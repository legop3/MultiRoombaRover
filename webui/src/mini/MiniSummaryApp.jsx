import { useEffect, useMemo, useState } from 'react';
import { SettingsProvider } from '../settings/index.js';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrames } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../hooks/useRoverSnapshots.js';
import { useSpectatorMode } from '../hooks/useSpectatorMode.js';
import VideoTile from '../components/VideoTile.jsx';
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
  return mode === 'turns' && turnInfo?.current ? `${label}` : label;
}

function getBatteryVisual({ rover, frame }) {
  const percentDisplay = rover?.batteryState?.percentDisplay;
  const urgentActive = rover?.batteryState?.urgentActive ?? false;
  const warnActive = rover?.batteryState?.warnActive ?? false;
  const config = rover?.battery ?? null;
  const charge = frame?.sensors?.batteryChargeMah ?? null;
  const full = config?.Full ?? null;
  const warn = config?.Warn ?? null;
  const urgent = config?.Urgent ?? null;

  if (percentDisplay != null && Number.isFinite(percentDisplay)) {
    const percent = Math.max(0, Math.min(1, percentDisplay / 100));
    const barClass = urgentActive ? 'bg-red-500/40' : warnActive ? 'bg-amber-400/40' : 'bg-emerald-400/40';
    return { percent, barClass };
  }

  if (charge == null || full == null || warn == null) {
    return { percent: 0, barClass: 'bg-slate-700/40' };
  }

  const span = full - warn;
  if (span <= 0) {
    return { percent: 0, barClass: 'bg-slate-700/40' };
  }

  const normalized = (charge - warn) / span;
  const percent = Math.max(0, Math.min(1, normalized));
  const depleted = normalized <= 0;
  const warnTriggered = urgent != null && charge <= urgent;
  const barClass = depleted ? 'bg-red-500/40' : warnTriggered ? 'bg-amber-400/40' : 'bg-emerald-400/40';
  return { percent, barClass };
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
              hudLabelScale={7}
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
      <aside className="flex h-full min-w-0 flex-1 flex-col border-l border-slate-800/60 bg-slate-950/90">
        {roster.length ? (
          roster.map((rover) => {
            const frame = frames[rover.id] || null;
            const driverText = formatDriverLabel({ roverId: rover.id, session });
            const batteryVisual = getBatteryVisual({ rover, frame });
            const isActive = activeRover?.id === rover.id;
            return (
              <div
                key={rover.id}
                className={`relative flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden px-6 py-4 ${
                  isActive ? 'border-4 border-emerald-300/90 bg-emerald-300/10' : 'opacity-60'
                }`}
              >
                <div
                  className={`absolute inset-y-0 left-0 ${batteryVisual.barClass}`}
                  style={{ width: `${batteryVisual.percent * 100}%` }}
                />
                <div className="relative flex flex-col gap-1">
                  <div className={`text-6xl font-semibold tracking-wide ${isActive ? 'text-white' : 'text-slate-200'}`}>
                    {rover.name || rover.id}
                  </div>
                  <div className={`text-5xl font-semibold ${isActive ? 'text-white' : 'text-slate-300'}`}>
                    {driverText}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
            No rovers available.
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
