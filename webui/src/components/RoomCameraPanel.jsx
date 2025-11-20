import { useSession } from '../context/SessionContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import VideoTile from './VideoTile.jsx';

function EmptyState() {
  return (
    <div className="panel-section space-y-0.5 text-sm">
      <p className="text-center text-slate-400">No room cameras configured.</p>
      <p className="text-center text-slate-500">Add entries to server config to populate this list.</p>
    </div>
  );
}

export default function RoomCameraPanel() {
  const { session } = useSession();
  const cameras = session?.roomCameras || [];
  const sourceDescriptors = cameras.map((camera) => ({ type: 'room', id: camera.id, key: `room:${camera.id}` }));
  const videoSources = useVideoRequests(sourceDescriptors);

  if (cameras.length === 0) {
    return <EmptyState />;
  }

  return (
    <section className="panel-section space-y-0.5 text-base">
      <header className="flex items-center justify-between text-sm text-slate-400">
        <p>Room cameras</p>
        <span>{cameras.length}</span>
      </header>
      <div className="grid gap-0.5 sm:grid-cols-2">
        {cameras.map((camera) => {
          const key = `room:${camera.id}`;
          const sessionInfo = videoSources[key];
          return (
            <article key={camera.id} className="space-y-0.5 rounded border border-slate-800 bg-zinc-950 p-0.5">
              <header className="space-y-0.5">
                <p className="text-lg font-semibold text-white">{camera.name || camera.id}</p>
                {camera.description && <p className="text-xs text-slate-500">{camera.description}</p>}
              </header>
              <VideoTile
                sessionInfo={sessionInfo}
                label={camera.name || camera.id}
                forceMute
                showBatteryBar={false}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
