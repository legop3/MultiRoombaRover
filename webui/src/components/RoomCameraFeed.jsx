import { useEffect, useMemo, useRef, useState } from 'react';
import { WhepPlayer } from '../lib/whepPlayer.js';

function RoomCameraVideo({ sessionInfo, label, onStatus }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!sessionInfo?.url || !videoRef.current) return undefined;
    let active = true;
    let player;

    const handleStatus = (nextStatus, info) => {
      if (!active) return;
      setStatus(nextStatus);
      setDetail(info || null);
      if (typeof onStatus === 'function') {
        onStatus(nextStatus);
      }
    };

    player = new WhepPlayer({
      url: sessionInfo.url,
      token: sessionInfo.token,
      video: videoRef.current,
      onStatus: handleStatus,
    });

    player.start().catch((err) => {
      if (!active) return;
      setStatus('error');
      setDetail(err.message);
      if (typeof onStatus === 'function') {
        onStatus('error');
      }
    });

    return () => {
      active = false;
      player?.stop();
    };
  }, [sessionInfo?.url, sessionInfo?.token, onStatus]);

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        muted
        playsInline
        autoPlay
        controls={false}
        aria-label={label}
      />
      {status !== 'playing' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
          {detail ? `Video error: ${detail}` : 'Connecting video…'}
        </div>
      )}
    </div>
  );
}

export default function RoomCameraFeed({ feed, label, videoSession = null, preferVideo = false }) {
  const [blink, setBlink] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    setVideoFailed(false);
  }, [videoSession?.url, videoSession?.token]);

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

  const showVideo = Boolean(preferVideo && videoSession?.url && !videoFailed);
  const showSnapshot = Boolean(!showVideo && feed?.objectUrl);

  return (
    <div className="relative w-full overflow-hidden rounded bg-black" style={{ aspectRatio: '4 / 3' }}>
      {showVideo ? (
        <RoomCameraVideo
          sessionInfo={videoSession}
          label={label}
          onStatus={(nextStatus) => {
            if (['error', 'failed', 'disconnected', 'closed'].includes(nextStatus)) {
              setVideoFailed(true);
            }
          }}
        />
      ) : showSnapshot ? (
        <img src={feed.objectUrl} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-300">
          {preferVideo ? 'Waiting for video…' : 'Waiting for frame…'}
        </div>
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
