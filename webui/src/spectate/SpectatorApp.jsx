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

  return (
    <div className="min-h-screen bg-black text-slate-100 md:h-screen md:overflow-hidden">
      <main className="grid min-h-screen grid-cols-1 gap-0.5 p-0 md:h-full md:min-h-0 md:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-h-0 min-w-0 flex-col gap-0.5 md:overflow-y-auto">
          <RoverRow
            roster={roster}
            frames={frames}
            snapshotFeeds={snapshotFeeds}
            audioSources={audioSources}
            session={session}
          />
          <SecondaryRow />
        </section>
        <section className="flex min-h-0 min-w-0 flex-col gap-0.5 md:h-full">
          <CommunityGoalBanner layout="desktop" />
          <div className="panel">
            <RoverQueuesPanel title="Rovers" />
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <RawUserPilePanel hideNicknameForm hideHeader fillHeight className="h-full" />
          </div>
          <div className="min-h-0 min-w-0 flex-[1.1] overflow-hidden">
            <ChatPanel hideInput hideSpectatorNotice fillHeight />
          </div>
          <div className="min-h-0 min-w-0">
            <LogsRow className="h-40 overflow-hidden" />
          </div>
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
