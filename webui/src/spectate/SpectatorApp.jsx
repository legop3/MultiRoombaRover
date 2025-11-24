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
    <div className="surface space-y-0.25 text-sm text-slate-200">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Telemetry</span>
        <span>{updated ? `Updated ${updated}` : 'Waiting...'}</span>
      </div>
      <div className="grid grid-cols-2 gap-0.25">
        {entries.map(([label, value]) => (
          <div key={label} className="surface-muted flex items-center justify-between px-0.5 py-0.25 text-xs">
            <span className="text-slate-400">{label}</span>
            <span className="font-semibold text-white">{value}</span>
          </div>
        ))}
      </div>
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
    <article className="space-y-0.5 bg-zinc-900 p-0.5">
      <header className="flex flex-col gap-0.25">
        <h3 className="text-2xl font-semibold text-white leading-tight">{rover.name}</h3>
        <CurrentDriverBadge roverId={rover.id} session={session} />
      </header>
      <VideoTile sessionInfo={videoInfo} label={rover.name} telemetryFrame={frame} batteryConfig={rover.battery} />
      <TelemetrySummary frame={frame} />
    </article>
  );
}

function RoverRow({ roster, frames, videoSources, session }) {
  if (roster.length === 0) {
    return <p className="col-span-full text-slate-400">No rovers registered.</p>;
  }
  return (
    <section className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
    <section className="grid grid-cols-1 gap-0.5 lg:grid-cols-[2fr_1fr_1fr]">
      <RoomCameraPanel defaultOrientation="horizontal" hideLayoutToggle hideHeader />
      <div className="flex flex-col">
        <UserListPanel hideNicknameForm hideHeader heightClass="h-[50vh]" />
      </div>
      <div className="flex flex-col">
        <ChatPanel hideInput hideSpectatorNotice heightClass="h-[50vh]" />
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
      <div className="min-h-screen bg-black text-slate-100">
        <main className="flex flex-col gap-0.5 p-0.5">
          <RoverRow roster={roster} frames={frames} videoSources={videoSources} session={session} />
          <SecondaryRow />
          <LogsRow />
        </main>
      </div>
    </SettingsProvider>
  );
}
