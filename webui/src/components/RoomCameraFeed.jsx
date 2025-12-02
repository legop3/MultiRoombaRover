import { useMemo } from 'react';

export default function RoomCameraFeed({ feed, label }) {
  const statusText = useMemo(() => {
    if (!feed) return 'Connecting…';
    if (feed.error) return `Error: ${feed.error}`;
    if (feed.status === 'playing' && feed.stale) return 'Stale frame';
    return feed.status || 'Connecting…';
  }, [feed]);

  return (
    <div className="relative w-full overflow-hidden rounded bg-black" style={{ aspectRatio: '4 / 3' }}>
      {feed?.objectUrl ? (
        <img src={feed.objectUrl} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-300">Waiting for frame…</div>
      )}
      <div className="pointer-events-none absolute left-0 top-0 bg-black/70 px-0.5 py-0.5 text-xs font-semibold text-white">
        {label}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 m-0.5 rounded bg-black/70 px-0.5 py-0.25 text-[0.7rem] text-slate-100">
        {statusText}
      </div>
    </div>
  );
}
