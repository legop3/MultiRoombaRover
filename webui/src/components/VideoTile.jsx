import { useCallback, useEffect, useRef, useState } from 'react';
import { WhepPlayer } from '../lib/whepPlayer.js';

const RESTART_DELAY_MS = 2000;
const UNMUTE_RETRY_MS = 3000;

export default function VideoTile({ sessionInfo, label, forceMute = false }) {
  const videoRef = useRef(null);
  const restartTimer = useRef(null);
  const unmuteTimer = useRef(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [restartToken, setRestartToken] = useState(0);
  const [muted, setMuted] = useState(true);

  const scheduleRestart = useCallback(() => {
    clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => setRestartToken(Date.now()), RESTART_DELAY_MS);
  }, []);

  const attemptUnmute = useCallback(
    (delay = 0) => {
      if (forceMute) return;
      clearTimeout(unmuteTimer.current);
      unmuteTimer.current = setTimeout(async () => {
        const video = videoRef.current;
        if (!video) return;
        try {
          video.muted = false;
          await video.play();
          setMuted(false);
        } catch (err) {
          video.muted = true;
          setMuted(true);
          attemptUnmute(UNMUTE_RETRY_MS);
        }
      }, delay);
    },
    [forceMute],
  );

  useEffect(
    () => () => {
      clearTimeout(restartTimer.current);
      clearTimeout(unmuteTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (status === 'playing') {
      attemptUnmute(0);
    }
  }, [status, attemptUnmute]);

  useEffect(() => {
    if (!sessionInfo?.url || !videoRef.current) {
      setStatus('waiting');
      setDetail(null);
      return undefined;
    }
    let active = true;
    let player;
    setMuted(true);
    const handleStatus = (nextStatus, info) => {
      if (!active) return;
      setStatus(nextStatus);
      setDetail(info || null);
      if (['error', 'failed', 'disconnected', 'closed'].includes(nextStatus)) {
        scheduleRestart();
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
      scheduleRestart();
    });

    return () => {
      active = false;
      player?.stop();
    };
  }, [sessionInfo?.url, sessionInfo?.token, restartToken, scheduleRestart]);

  useEffect(() => {
    if (status === 'stopped' && sessionInfo?.url) {
      scheduleRestart();
    }
  }, [status, sessionInfo?.url, scheduleRestart]);

  const renderedStatus =
    status === 'error'
      ? `Error: ${detail || 'unknown'}`
      : detail
      ? `${status} (${detail})`
      : status;

  return (
    <div className="space-y-2">
      <div className="w-full overflow-hidden rounded-2xl border border-slate-800 bg-black">
        <video
          ref={videoRef}
          muted={forceMute || muted}
          playsInline
          autoPlay
          controls={false}
          className="h-full w-full object-contain"
        />
      </div>
      <div className="text-xs text-slate-400">
        <span className="font-semibold text-slate-200">{label}</span>{' '}
        <span>{renderedStatus}</span>
      </div>
    </div>
  );
}
