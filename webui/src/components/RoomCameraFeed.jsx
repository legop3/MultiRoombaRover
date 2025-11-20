import { useCallback, useEffect, useRef, useState } from 'react';
import { WhepPlayer } from '../lib/whepPlayer.js';

const RESTART_DELAY_MS = 2000;
const UNMUTE_RETRY_MS = 3000;

export default function RoomCameraFeed({ sessionInfo, label }) {
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

  const ensurePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.muted = true;
      await video.play();
    } catch {
      // Autoplay might be blocked; retry later.
    }
  }, []);

  const attemptUnmute = useCallback(
    (delay = 0) => {
      clearTimeout(unmuteTimer.current);

      const scheduleRetry = () => {
        clearTimeout(unmuteTimer.current);
        unmuteTimer.current = setTimeout(() => {
          tryPlay();
        }, UNMUTE_RETRY_MS);
      };

      const tryPlay = async () => {
        const video = videoRef.current;
        if (!video) return;
        try {
          await ensurePlayback();
          video.muted = false;
          await video.play();
          setMuted(false);
        } catch {
          video.muted = true;
          setMuted(true);
          scheduleRetry();
        }
      };

      unmuteTimer.current = setTimeout(tryPlay, delay);
    },
    [ensurePlayback],
  );

  useEffect(
    () => () => {
      clearTimeout(restartTimer.current);
      clearTimeout(unmuteTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!sessionInfo?.url || !videoRef.current) {
      return undefined;
    }
    let active = true;
    let player;
    const resetMuteId = setTimeout(() => setMuted(true), 0);
    const handleStatus = (nextStatus, info) => {
      if (!active) return;
      setStatus(nextStatus);
      setDetail(info || null);
      if (nextStatus === 'playing') {
        ensurePlayback();
        attemptUnmute(0);
      }
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
      clearTimeout(resetMuteId);
      player?.stop();
    };
  }, [sessionInfo?.url, sessionInfo?.token, restartToken, scheduleRestart, ensurePlayback, attemptUnmute]);

  useEffect(() => {
    if (status === 'stopped' && sessionInfo?.url) {
      scheduleRestart();
    }
  }, [status, sessionInfo?.url, scheduleRestart]);

  const renderedStatus = !sessionInfo?.url
    ? 'Waiting for stream session'
    : status === 'error'
    ? `Error: ${detail || 'unknown'}`
    : detail
    ? `${status} (${detail})`
    : status;

  return (
    <div className="space-y-0.5">
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <video ref={videoRef} muted={muted} playsInline autoPlay controls={false} className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute left-0 top-0 bg-black/70 px-0.5 py-0.5 text-xs font-semibold text-white">
          {label}
        </div>
      </div>
      <p className="text-xs text-slate-500">{renderedStatus}</p>
    </div>
  );
}
