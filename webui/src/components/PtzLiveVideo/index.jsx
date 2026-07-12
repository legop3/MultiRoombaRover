// PTZ Live Video
// Purpose: Plays the single PTZ camera WHEP stream with the same fresh-session retry loop used by rover video.
// Scope: Owns browser-side WHEP playback/retry only; server authorization and snapshot fallback policy stay outside.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { WhepPlayer } from '../../lib/whepPlayer.js';
import { RESTART_DELAY_MS } from '../RoverMediaPlayer/constants.js';

export const PTZ_CAMERA_ID = 'ptz-camera';

const PTZ_AUDIO_RETRY_MS = 1000;
const TERMINAL_WHEP_STATES = new Set(['error', 'failed', 'disconnected', 'closed']);
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
  label = null,
  labelClassName = 'pointer-events-none absolute left-0 top-0 bg-black/70 px-1 py-0.5 text-xs font-semibold text-white',
  fallback = null,
}) {
  const videoRef = useRef(null);
  const retryTimerRef = useRef(null);
  const playTimerRef = useRef(null);
  const enabledRef = useRef(enabled);
  const fallbackRef = useRef(false);
  const playerGenerationRef = useRef(0);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [restartToken, setRestartToken] = useState(0);
  const sources = useVideoRequests(
    [{ type: 'ptz', id: PTZ_CAMERA_ID, key: PTZ_CAMERA_ID }],
    { enabled, version: restartToken },
  );
  const source = sources[PTZ_CAMERA_ID] || null;
  const shouldUseFallback = Boolean(source?.error && isAuthorizationError(source.error));

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    fallbackRef.current = shouldUseFallback;
  }, [shouldUseFallback]);

  useEffect(() => {
    if (enabled && !shouldUseFallback) return undefined;
    /*
      A retry that was scheduled before the server denied live access should not
      keep firing in snapshot mode. Clear it when live playback is no longer the
      active display policy.
    */
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    return undefined;
  }, [enabled, shouldUseFallback]);

  const scheduleRestart = useCallback(() => {
    if (!enabledRef.current || fallbackRef.current) return;
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
  }, []);

  useEffect(() => {
    if (!enabled || shouldUseFallback || !source?.url || !videoRef.current) return undefined;
    let active = true;
    const generation = playerGenerationRef.current + 1;
    playerGenerationRef.current = generation;
    const player = new WhepPlayer({
      url: source.url,
      token: source.token,
      video: videoRef.current,
      startMuted,
      onStatus: (nextStatus, info) => {
        /*
          Old PeerConnection callbacks can arrive after React has already
          cleaned up this effect for a newer token. Only the currently-owned
          generation is allowed to update status or schedule another restart.
        */
        if (!active || playerGenerationRef.current !== generation) return;
        const normalized = String(nextStatus || '').toLowerCase();
        setStatus(nextStatus || 'unknown');
        setDetail(info || null);
        if (TERMINAL_WHEP_STATES.has(normalized)) {
          scheduleRestart();
        }
      },
    });

    player.start().catch((err) => {
      if (!active || playerGenerationRef.current !== generation) return;
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
    const generation = playerGenerationRef.current;

    const handleEnded = () => {
      if (playerGenerationRef.current !== generation) return;
      setStatus('stopped');
      setDetail('ended');
      scheduleRestart();
    };
    const handleError = () => {
      if (playerGenerationRef.current !== generation) return;
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
