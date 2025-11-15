import { useEffect, useRef, useState } from 'react';
import { WhepPlayer } from '../lib/whepPlayer.js';

export default function VideoTile({ sessionInfo, label, muted = true }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    let player;
    let cancelled = false;

    async function start() {
      if (!sessionInfo?.url || !videoRef.current) {
        setStatus('waiting');
        return;
      }
      setStatus('connecting');
      setError(null);
      player = new WhepPlayer({
        url: sessionInfo.url,
        token: sessionInfo.token,
        video: videoRef.current,
      });
      try {
        await player.start();
        if (!cancelled) {
          setStatus('playing');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err.message);
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      player?.stop();
    };
  }, [sessionInfo?.url, sessionInfo?.token]);

  return (
    <div className="space-y-2">
      <div className="aspect-video w-full overflow-hidden rounded-2xl border border-slate-800 bg-black">
        <video
          ref={videoRef}
          muted={muted}
          playsInline
          autoPlay
          controls={false}
          className="h-full w-full object-contain"
        />
      </div>
      <div className="text-xs text-slate-400">
        <span className="font-semibold text-slate-200">{label}</span>{' '}
        {status === 'error' ? <span className="text-red-400">Error: {error}</span> : <span>{status}</span>}
      </div>
    </div>
  );
}
