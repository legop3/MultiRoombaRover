import { useEffect, useState } from 'react';
import { SettingsProvider } from '../settings/index.js';
import { useSession } from '../context/SessionContext.jsx';
import { useSpectatorMode } from '../hooks/useSpectatorMode.js';
import { useTelemetryFrames } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../hooks/useRoverSnapshots.js';
import VideoTile from '../components/VideoTile.jsx';
import RoomCameraPanel from '../components/RoomCameraPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import LogPanel from '../components/LogPanel.jsx';
import AlertFeed from '../components/AlertFeed.jsx';
import useDefaultNickname from '../hooks/useDefaultNickname.js';
import CommunityGoalBanner from '../components/CommunityGoalBanner.jsx';
import RoverQueuesPanel from '../components/RoverQueuesPanel.jsx';
import RawUserPilePanel from '../components/RawUserPilePanel.jsx';

function usePortraitLayout() {
  const [isPortrait, setIsPortrait] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-aspect-ratio: 4/3)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-aspect-ratio: 4/3)');
    const handleChange = (event) => setIsPortrait(event.matches);
    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
    } else {
      media.addListener(handleChange);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', handleChange);
      } else {
        media.removeListener(handleChange);
      }
    };
  }, []);

  return isPortrait;
}

function formatDriverLabel({ roverId, session }) {
  const activeDriverId = session?.activeDrivers?.[roverId] || null;
  const user = (session?.users || []).find((entry) => entry.socketId === activeDriverId);
  const label = user?.nickname || (activeDriverId ? activeDriverId.slice(0, 6) : 'No driver');
  const mode = session?.mode;
  const turnInfo = session?.turnQueues?.[roverId];
  const driverText = mode === 'turns' && turnInfo?.current ? `${label} (turns)` : label;

  return driverText;
}

function RoverSpectatorCard({ rover, frame, snapshotFeed, audioInfo, session }) {
  const driverLabel = formatDriverLabel({ roverId: rover.id, session });
  return (
    <article className="min-h-[16rem] rounded bg-zinc-900 p-0 sm:min-h-[18rem]">
      <div className="min-h-0 overflow-hidden rounded bg-black/20">
        <VideoTile
          sessionInfo={null}
          videoMode="snapshot"
          snapshotFeed={snapshotFeed}
          audioSessionInfo={audioInfo}
          label={rover.name}
          telemetryFrame={frame}
          batteryConfig={rover.battery}
          hudVariant="spectator"
          driverLabel={driverLabel}
          hudForceMap
          hudMapPosition="bottom-left"
        />
      </div>
    </article>
  );
}

function RoverRow({ roster, frames, snapshotFeeds, audioSources, session }) {
  if (roster.length === 0) {
    return <p className="col-span-full text-slate-400">No rovers registered.</p>;
  }
  return (
    <section className="grid grid-cols-1 gap-0.5 md:grid-cols-2">
      {roster.map((rover) => (
        <RoverSpectatorCard
          key={rover.id}
          rover={rover}
          frame={frames[rover.id]}
          snapshotFeed={snapshotFeeds[rover.id]}
          audioInfo={audioSources[`${rover.id}-audio`]}
          session={session}
          showHudMap
          hudMapPosition="bottom-left"
        />
      ))}
    </section>
  );
}

function SecondaryRow() {
  return (
    <section className="min-h-0">
      <div className="surface min-h-[14rem] overflow-hidden">
        <RoomCameraPanel
          defaultOrientation="horizontal"
          hideLayoutToggle
          hideHeader
          panelId="spectator-secondary"
        />
      </div>
    </section>
  );
}

function LogsRow({ className = '' }) {
  return (
    <div className={`panel ${className}`}>
      <LogPanel />
    </div>
  );
}

function SpectatorContent() {
  const { session } = useSession();
  const inLockdown = session?.mode === 'lockdown';
  useDefaultNickname();
  useSpectatorMode();
  const isPortraitLayout = usePortraitLayout();
  const frames = useTelemetryFrames();
  const roster = session?.roster ?? [];
  const snapshotFeeds = useRoverSnapshots(
    roster.map((rover) => rover.id),
    { enabled: !inLockdown, version: session?.mode },
  );
  const audioEntries = roster.flatMap((rover) =>
    rover.media?.audioPublishUrl
      ? [{ type: 'rover', id: `${rover.id}-audio`, key: `${rover.id}-audio` }]
      : [],
  );
  const audioSources = useVideoRequests(audioEntries, { enabled: !inLockdown, version: session?.mode });

  if (inLockdown) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-slate-200">
        <div className="surface max-w-md space-y-0.5 p-1 text-center text-sm">
          <p className="text-lg font-semibold text-white">Spectate disabled during lockdown.</p>
          <p className="text-slate-300">Please wait until the server leaves lockdown to view streams.</p>
        </div>
      </div>
    );
  }

  const mainClass = isPortraitLayout
    ? 'flex min-h-screen flex-col bg-black text-slate-100 md:h-screen md:overflow-hidden'
    : 'grid min-h-screen grid-cols-1 gap-0.5 bg-black text-slate-100 md:h-full md:min-h-0 md:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_20rem]';
  const contentClass = isPortraitLayout
    ? 'order-2 flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto'
    : 'order-1 flex min-h-0 min-w-0 flex-col gap-0.5 md:overflow-y-auto';
  const sidebarClass = isPortraitLayout
    ? 'order-1 grid w-full min-h-0 items-stretch gap-0.5 border-b border-slate-800/60 bg-slate-950/90 p-0.5 grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.9fr)_minmax(0,0.7fr)]'
    : 'order-2 flex min-h-0 min-w-0 flex-col gap-0.5 border-l border-slate-800/60 bg-slate-950/90 md:h-full md:overflow-y-auto';
  const topBarItemClass = isPortraitLayout ? '' : '';
  const portraitItemHeight = isPortraitLayout ? 'h-64' : '';

  return (
    <div className="min-h-screen bg-black text-slate-100 md:h-screen md:overflow-hidden">
      <main className={mainClass}>
        <section className={sidebarClass}>
          {isPortraitLayout ? (
            <div className={`${topBarItemClass} ${portraitItemHeight} flex flex-col gap-0.5`}>
              <CommunityGoalBanner layout="desktop" dismissable={false} className="text-sm" />
              <div className="min-h-0 flex-1">
                <RawUserPilePanel hideNicknameForm hideHeader compact fillHeight className="h-full" />
              </div>
            </div>
          ) : (
            <div className={topBarItemClass}>
              <CommunityGoalBanner layout="desktop" dismissable={false} className="text-sm" />
            </div>
          )}
          <div className={`${topBarItemClass} ${isPortraitLayout ? `${portraitItemHeight} overflow-y-auto` : ''}`}>
            <div className="panel h-full">
              <RoverQueuesPanel title="Rovers" />
            </div>
          </div>
          {!isPortraitLayout ? (
            <div className={`${topBarItemClass} flex-1 min-h-0`}>
              <RawUserPilePanel hideNicknameForm hideHeader compact fillHeight className="h-full" />
            </div>
          ) : null}
          <div className={`${topBarItemClass} ${isPortraitLayout ? portraitItemHeight : 'flex-[1.1] min-h-0'}`}>
            <ChatPanel hideInput hideSpectatorNotice fillHeight />
          </div>
          <div className={`${topBarItemClass} ${isPortraitLayout ? portraitItemHeight : ''}`}>
            <LogsRow className={`${isPortraitLayout ? 'h-full' : 'h-40'} overflow-hidden`} />
          </div>
        </section>
        <section className={contentClass}>
          <RoverRow
            roster={roster}
            frames={frames}
            snapshotFeeds={snapshotFeeds}
            audioSources={audioSources}
            session={session}
          />
          <SecondaryRow />
        </section>
      </main>
      <AlertFeed />
    </div>
  );
}

export default function SpectatorApp() {
  return (
    <SettingsProvider>
      <SpectatorContent />
    </SettingsProvider>
  );
}
