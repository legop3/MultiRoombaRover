import { useEffect, useMemo, useState } from 'react';

export default function RoomCameraFeed({ feed, label }) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (!feed) return;
    if (!feed.ts && !feed.objectUrl) return;
    setBlink((prev) => !prev);
  }, [feed?.ts, feed?.objectUrl]);

  const statusText = useMemo(() => {
    if (!feed) return 'Connecting…';
    if (feed.error) return `Error: ${feed.error}`;
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
      <div className="pointer-events-none absolute bottom-0 left-0 m-0.5 flex items-center gap-1 rounded bg-black/70 px-0.5 py-0.25 text-[0.7rem] text-slate-100">
        <span className={`h-2 w-2 rounded-full ${blink ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        <span>{statusText}</span>
      </div>
    </div>
  );
}
