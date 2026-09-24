// PTZ Live Video
// Purpose: Plays the single PTZ camera WHEP stream with the same fresh-session retry loop used by rover video.
// Scope: Owns browser-side WHEP playback/retry only; server authorization and snapshot fallback policy stay outside.
import { useEffect, useRef, useState } from 'react';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { startWhepPlayback } from '../../lib/whepPlayback.js';
import useWhepRestart from '../../hooks/useWhepRestart.js';

export const PTZ_CAMERA_ID = 'ptz-camera';

const PTZ_AUDIO_RETRY_MS = 1000;
const AUTHORIZATION_ERROR_RE = /not authorized/i;

function isAuthorizationError(error) {
  return AUTHORIZATION_ERROR_RE.test(String(error || ''));
}

export default function PtzLiveVideo({
  enabled = true,
  startMuted = true,
  className = 'relative h-full w-full bg-black',
  videoClassName = 'h-full w-full object-contain',
  statusClassName = 'pointer-events-none absolute left-1 top-1 z-20 font-medium text-slate-100 text-[0.65rem]',
  fallback = null,
}) {
  const videoRef = useRef(null);
  const playTimerRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const { restartToken, scheduleRestart, cancelRestart } = useWhepRestart(enabled);
  const sources = useVideoRequests(
    [{ type: 'ptz', id: PTZ_CAMERA_ID, key: PTZ_CAMERA_ID }],
    { enabled, version: restartToken },
  );
  const source = sources[PTZ_CAMERA_ID] || null;
  const shouldUseFallback = Boolean(source?.error && isAuthorizationError(source.error));

  useEffect(() => {
    // An authorization denial switches to snapshots and cancels any queued retry.
    if (shouldUseFallback) cancelRestart();
  }, [shouldUseFallback, cancelRestart]);

  useEffect(() => {
    if (!enabled || shouldUseFallback || !source?.url || !videoRef.current) return undefined;
    const video = videoRef.current;
    const stop = startWhepPlayback({
      url: source.url,
      token: source.token,
      video: videoRef.current,
      startMuted,
      scheduleRestart,
      onStatus: (nextStatus, info) => {
        setStatus(nextStatus || 'unknown');
        setDetail(info || null);
      },
      onError: (err) => {
        setStatus('error');
        setDetail(err.message || 'WHEP start failed');
      },
    });
    const handleEnded = () => {
      setStatus('stopped');
      setDetail('ended');
      scheduleRestart();
    };
    const handleError = () => {
      setStatus('error');
      setDetail(video.error?.message || 'video element error');
      scheduleRestart();
    };

    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    return () => {
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      stop();
    };
  }, [enabled, scheduleRestart, shouldUseFallback, source?.token, source?.url, startMuted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || shouldUseFallback || startMuted || !source?.url || !video) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      playTimerRef.current = null;
      return undefined;
    }

    /*
      PTZ carries inline Opus audio. When the operator opened the camera from a
      user gesture, keep retrying audible playback so browser autoplay timing
      does not leave the element permanently muted after a reconnect.
    */
    const attemptPlay = () => {
      const target = videoRef.current;
      if (!target) return;
      target.muted = false;
      if (!target.paused && !target.ended) return;
      target.play().catch(() => {});
    };

    attemptPlay();
    playTimerRef.current = setInterval(attemptPlay, PTZ_AUDIO_RETRY_MS);
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    };
  }, [enabled, shouldUseFallback, source?.url, startMuted, status]);

  useEffect(() => () => {
    if (playTimerRef.current) clearInterval(playTimerRef.current);
  }, []);

  if (shouldUseFallback && typeof fallback === 'function') {
    return fallback({ source, status, detail });
  }

  const displayStatus = source?.error || detail || status;

  return (
    <div className={className}>
      {source?.url ? (
        <video ref={videoRef} className={videoClassName} playsInline autoPlay muted={startMuted} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
          {source?.error || 'Waiting for PTZ video...'}
        </div>
      )}
      {/*
        PTZ video uses the same low-profile diagnostic shape as the rover
        players: no in-frame camera title, just a compact top-corner status.
        This keeps the media pane visually interchangeable with rover streams
        while still exposing WHEP/session failures during reconnects.
      */}
      <div className={statusClassName}>
        <div className="flex flex-col gap-0.5 leading-none">
          <span>Status: {displayStatus}</span>
        </div>
      </div>
    </div>
  );
}
