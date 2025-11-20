import { useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import RoomCameraFeed from './RoomCameraFeed.jsx';

function EmptyState() {
  return (
    <div className="panel-section space-y-0.5 text-sm">
      <p className="text-center text-slate-400">No room cameras configured.</p>
      <p className="text-center text-slate-500">Add entries to server config to populate this list.</p>
    </div>
  );
}

const ORIENTATIONS = ['horizontal', 'vertical'];

function normalizeOrientation(value, fallback) {
  if (ORIENTATIONS.includes(value)) {
    return value;
  }
  return fallback;
}

export default function RoomCameraPanel({ defaultOrientation = 'horizontal', orientation: forcedOrientation }) {
  const { session } = useSession();
  const cameras = session?.roomCameras || [];
  const sourceDescriptors = cameras.map((camera) => ({ type: 'room', id: camera.id, key: `room:${camera.id}` }));
  const videoSources = useVideoRequests(sourceDescriptors);
  const [orientation, setOrientation] = useState(() =>
    normalizeOrientation(defaultOrientation, 'horizontal'),
  );
  const effectiveOrientation = forcedOrientation
    ? normalizeOrientation(forcedOrientation, 'horizontal')
    : orientation;
  const containerClass =
    effectiveOrientation === 'vertical' ? 'flex flex-col gap-0.5' : 'grid gap-0.5 md:grid-cols-2';
  const showLayoutToggle = !forcedOrientation && cameras.length > 0;

  if (cameras.length === 0) {
    return <EmptyState />;
  }

  return (
    <section className="panel-section space-y-0.5 text-base">
      <header className="flex flex-wrap items-center justify-between gap-0.5 text-sm text-slate-400">
        <div className="flex items-center gap-1">
          <p>Room cameras</p>
          <span className="text-xs text-slate-500">{cameras.length}</span>
        </div>
        {showLayoutToggle && (
          <div className="flex items-center gap-0.5 text-xs">
            <span className="text-slate-500">Layout:</span>
            <div className="inline-flex overflow-hidden rounded border border-slate-700">
              {ORIENTATIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`px-1 py-0.5 ${effectiveOrientation === option ? 'bg-slate-600 text-white' : 'bg-transparent text-slate-400 hover:text-white'}`}
                  onClick={() => setOrientation(option)}
                >
                  {option === 'vertical' ? 'Vertical' : 'Grid'}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>
      <div className={containerClass}>
        {cameras.map((camera) => {
          const key = `room:${camera.id}`;
          const sessionInfo = videoSources[key];
          return (
            <article key={camera.id} className="w-full space-y-0.5 rounded border border-slate-800 bg-zinc-950 p-0.5">
              <header className="space-y-0.5">
                <p className="text-lg font-semibold text-white">{camera.name || camera.id}</p>
                {camera.description && <p className="text-xs text-slate-500">{camera.description}</p>}
              </header>
              <RoomCameraFeed sessionInfo={sessionInfo} label={camera.name || camera.id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
