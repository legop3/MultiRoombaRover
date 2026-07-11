// PTZ Live Video
// Purpose: Plays the single PTZ camera WHEP stream with the same fresh-session retry loop used by rover video.
// Scope: Owns browser-side WHEP playback/retry only; server authorization and snapshot fallback policy stay outside.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { WhepPlayer } from '../../lib/whepPlayer.js';
import { RESTART_DELAY_MS } from '../RoverMediaPlayer/constants.js';

export const PTZ_CAMERA_ID = 'ptz-camera';

const PTZ_AUDIO_RETRY_MS = 1000;
const TERMINAL_WHEP_STATES = new Set(['error', 'failed', 'disconnected', 'closed', 'stopped']);
const AUTHORIZATION_ERROR_RE = /not authorized/i;

function isAuthorizationError(error) {
  return AUTHORIZATION_ERROR_RE.test(String(error || ''));
}

export default function PtzLiveVideo({
  enabled = true,
  startMuted = true,
  className = 'relative h-full w-full bg-black',
  videoClassName = 'h-full w-full object-contain',
  statusClassName = 'pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-slate-100',
  label = null,
  labelClassName = 'pointer-events-none absolute left-0 top-0 bg-black/70 px-1 py-0.5 text-xs font-semibold text-white',
  fallback = null,
}) {
  const videoRef = useRef(null);
  const retryTimerRef = useRef(null);
  const playTimerRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [restartToken, setRestartToken] = useState(0);
  const sources = useVideoRequests(
    [{ type: 'ptz', id: PTZ_CAMERA_ID, key: PTZ_CAMERA_ID }],
    { enabled, version: restartToken },
  );
  const source = sources[PTZ_CAMERA_ID] || null;
  const shouldUseFallback = Boolean(source?.error && isAuthorizationError(source.error));

  const scheduleRestart = useCallback(() => {
    if (!enabled || shouldUseFallback) return;
    /*
      WHEP sessions are one-shot browser/server negotiations. When the camera
      reboots, the old PeerConnection and token can look alive enough to keep a
      black element on screen, but they are not useful anymore. Bumping this
      token forces useVideoRequests to ask the server for a new MediaMTX auth
      session before creating the next WhepPlayer.
    */
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRestartToken(Date.now());
    }, RESTART_DELAY_MS);
  }, [enabled, shouldUseFallback]);

  useEffect(() => {
    if (!enabled || shouldUseFallback || !source?.url || !videoRef.current) return undefined;
    let active = true;
    const player = new WhepPlayer({
      url: source.url,
      token: source.token,
      video: videoRef.current,
      startMuted,
      onStatus: (nextStatus, info) => {
        if (!active) return;
        const normalized = String(nextStatus || '').toLowerCase();
        setStatus(nextStatus || 'unknown');
        setDetail(info || null);
        if (TERMINAL_WHEP_STATES.has(normalized)) {
          scheduleRestart();
        }
      },
    });

    player.start().catch((err) => {
      if (!active) return;
      setStatus('error');
      setDetail(err.message || 'WHEP start failed');
      scheduleRestart();
    });

    return () => {
      /*
        Mark inactive before stop() because WhepPlayer reports "stopped" during
        normal cleanup. Cleanup-driven stops should not immediately schedule the
        next retry; only the replacement effect should own the new connection.
      */
      active = false;
      player.stop();
    };
  }, [enabled, scheduleRestart, shouldUseFallback, source?.token, source?.url, startMuted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || shouldUseFallback || !source?.url || !video) return undefined;

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
    };
  }, [enabled, scheduleRestart, shouldUseFallback, source?.url]);

  useEffect(() => {
    if (status === 'stopped' && source?.url && !shouldUseFallback) {
      scheduleRestart();
    }
  }, [scheduleRestart, shouldUseFallback, source?.url, status]);

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
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
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
      {label ? <div className={labelClassName}>{label}</div> : null}
      <div className={statusClassName}>{displayStatus}</div>
    </div>
  );
}
