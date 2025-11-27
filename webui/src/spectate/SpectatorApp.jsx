import { SettingsProvider } from '../settings/index.js';
import { useSession } from '../context/SessionContext.jsx';
import { useSpectatorMode } from '../hooks/useSpectatorMode.js';
import { useTelemetryFrames } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import VideoTile from '../components/VideoTile.jsx';
import RoomCameraPanel from '../components/RoomCameraPanel.jsx';
import UserListPanel from '../components/UserListPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import LogPanel from '../components/LogPanel.jsx';

function TelemetrySummary({ frame }) {
  const sensors = frame?.sensors || {};
  const updated = frame?.receivedAt ? new Date(frame.receivedAt).toLocaleTimeString() : null;
  const entries = [
    ['Voltage', sensors.voltageMv != null ? `${(sensors.voltageMv / 1000).toFixed(2)} V` : '--'],
    ['Current', sensors.currentMa != null ? `${sensors.currentMa} mA` : '--'],
    ['Charge', sensors.batteryChargeMah != null ? `${sensors.batteryChargeMah}` : '--'],
    ['OI', sensors.oiMode?.label || '--'],
  ];

  return (
    <div className="surface-muted flex flex-wrap items-center gap-0.5 rounded px-0.5 py-0.25 text-[0.75rem] text-slate-200">
      <span className="text-[0.7rem] uppercase tracking-wide text-slate-500">
        {updated ? `Updated ${updated}` : 'Telemetry'}
      </span>
      {entries.map(([label, value]) => (
        <span key={label} className="flex items-center gap-0.25 rounded bg-slate-900/50 px-0.5 py-0.25">
          <span className="text-slate-400">{label}</span>
          <span className="font-semibold text-white">{value}</span>
        </span>
      ))}
    </div>
  );
}

function CurrentDriverBadge({ roverId, session }) {
  const activeDriverId = session?.activeDrivers?.[roverId] || null;
  const user = (session?.users || []).find((entry) => entry.socketId === activeDriverId);
  const label = user?.nickname || (activeDriverId ? activeDriverId.slice(0, 6) : 'No driver');
  const mode = session?.mode;
  const turnInfo = session?.turnQueues?.[roverId];
  const driverText = mode === 'turns' && turnInfo?.current ? `Driver: ${label} (turns)` : `Driver: ${label}`;

  return (
    <div className="surface-muted text-xs text-slate-300">
      {driverText}
    </div>
  );
}

function RoverSpectatorCard({ rover, frame, videoInfo, session }) {
  return (
    <article className="grid min-h-[16rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0.5 rounded bg-zinc-900 p-0.5 sm:min-h-[18rem]">
      <header className="flex items-center justify-between gap-0.5">
        <div className="flex flex-col leading-tight">
          <h3 className="text-xl font-semibold text-white">{rover.name}</h3>
          <CurrentDriverBadge roverId={rover.id} session={session} />
        </div>
        <span className="rounded bg-slate-800 px-1 text-[0.7rem] text-slate-300">
          Rover {rover.id}
        </span>
      </header>
      <div className="min-h-0 overflow-hidden rounded bg-black/20">
        <VideoTile
          sessionInfo={videoInfo}
          label={rover.name}
          telemetryFrame={frame}
          batteryConfig={rover.battery}
        />
      </div>
      <TelemetrySummary frame={frame} />
    </article>
  );
}

function RoverRow({ roster, frames, videoSources, session }) {
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
          videoInfo={videoSources[rover.id]}
          session={session}
        />
      ))}
    </section>
  );
}

function SecondaryRow() {
  return (
    <section className="min-h-0">
      <div className="surface min-h-[14rem] overflow-hidden">
        <RoomCameraPanel defaultOrientation="horizontal" hideLayoutToggle hideHeader />
      </div>
    </section>
  );
}

function LogsRow() {
  return (
    <div className="panel">
      <LogPanel />
    </div>
  );
}

export default function SpectatorApp() {
  const { session } = useSession();
  useSpectatorMode();
  const frames = useTelemetryFrames();
  const roster = session?.roster ?? [];
  const videoSources = useVideoRequests(roster.map((rover) => rover.id));

  return (
    <SettingsProvider>
      <div className="min-h-screen bg-black text-slate-100 md:h-screen md:overflow-hidden">
        <main className="grid min-h-screen grid-cols-1 gap-0.5 p-0.5 md:h-full md:min-h-0 md:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="flex min-h-0 min-w-0 flex-col gap-0.5 md:overflow-y-auto">
            <RoverRow roster={roster} frames={frames} videoSources={videoSources} session={session} />
            <SecondaryRow />
          </section>
          <section className="grid min-h-0 min-w-0 gap-0.5 md:h-full grid-rows-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="min-h-0 min-w-0 overflow-hidden">
              <UserListPanel hideNicknameForm hideHeader fillHeight className="h-full" />
            </div>
            <div className="min-h-0 min-w-0 overflow-hidden">
              <ChatPanel hideInput hideSpectatorNotice fillHeight />
            </div>
            <div className="min-h-0 min-w-0 overflow-hidden">
              <LogsRow />
            </div>
          </section>
        </main>
      </div>
    </SettingsProvider>
  );
}
