import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WhepPlayer } from '../../lib/whepPlayer.js';
import { useTelemetrySelector } from '../../context/TelemetryContext.jsx';
import {
  mainBrushAudioTelemetryEqual,
  selectMainBrushAudioTelemetry,
} from '../../context/telemetryViews.js';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { useRoverSnapshots } from '../../hooks/useRoverSnapshots.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { AUDIO_SETTINGS_DEFAULTS, VIDEO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import {
  RESTART_DELAY_MS,
  UNMUTE_RETRY_MS,
  AUDIO_RETRY_MS,
  BRUSH_CURRENT_THRESHOLD_MA,
  DUCK_RELEASE_FADE_MS,
} from './constants.js';

const VIDEO_FILTER_STYLES = {
  // The empty filter keeps the browser's native video presentation untouched when the user
  // wants normal color or when a rover's camera color is already useful.
  none: '',
  // Grayscale is the most reliable way to remove the pink cast from a no-IR-filter camera
  // because it depends on luminance instead of trying to guess the original scene colors.
  grayscale: 'grayscale(1) contrast(1.08)',
  // Greenscale is intentionally implemented as a CSS tint over grayscale rather than canvas
  // processing. That keeps latency low, works for both <video> and snapshot <img>, and avoids
  // interfering with WebRTC playback.
  greenscale: 'grayscale(1) sepia(1) hue-rotate(70deg) saturate(2.2) brightness(0.95) contrast(1.1)',
};

function normalizeVideoFilter(value) {
  // Persisted settings may outlive code changes, so every media render validates the stored
  // value before using it in a style. Unknown values fall back to full color.
  return Object.prototype.hasOwnProperty.call(VIDEO_FILTER_STYLES, value)
    ? value
    : VIDEO_SETTINGS_DEFAULTS.colorFilter;
}

function hasRoverAudioCapture(rover) {
  // The browser asks for the separate "<rover>-audio" WHEP source only when
  // roverd's media config says the microphone publisher is enabled and has a
  // concrete publish URL. That keeps UI media setup aligned with the daemon
  // config instead of probing for streams that should not exist.
  return Boolean(rover?.media?.audioCapture?.enabled && rover?.media?.audioCapture?.publishUrl);
}

function useVideoVisibilityGate(enabled) {
  const containerRef = useRef(null);
  const [observedVisibility, setObservedVisibility] = useState(false);

  useEffect(() => {
    /*
      Some surfaces, notably /mini, intentionally keep video players warm while
      they are visually hidden. The explicit opt-out must bypass every part of
      this gate so those existing reconnect and rotation semantics do not change.
    */
    if (!enabled) {
      return undefined;
    }

    const container = containerRef.current;
    if (!container || typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    let intersectsViewport = true;
    const publishVisibility = () => {
      /*
        IntersectionObserver covers media scrolled or laid out outside the
        viewport, while the Page Visibility API covers an otherwise intersecting
        player in a background browser tab. Video should run only when both are
        true; dedicated rover audio is deliberately not connected to this state.
      */
      setObservedVisibility(intersectsViewport && document.visibilityState !== 'hidden');
    };
    const handlePageVisibilityChange = () => publishVisibility();

    document.addEventListener('visibilitychange', handlePageVisibilityChange);

    if (typeof IntersectionObserver !== 'function') {
      /*
        Page visibility is still a useful safe fallback on older browsers. We
        cannot reliably infer scroll clipping without IntersectionObserver, so
        the video remains active while the page itself is visible.
      */
      publishVisibility();
      return () => document.removeEventListener('visibilitychange', handlePageVisibilityChange);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        intersectsViewport = Boolean(entry?.isIntersecting);
        publishVisibility();
      },
      {
        // Match room-camera behavior: do not pre-connect video before it reaches the viewport.
        root: null,
        rootMargin: '0px',
        threshold: 0,
      },
    );
    observer.observe(container);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handlePageVisibilityChange);
    };
  }, [enabled]);

  /*
    Derive the opt-out directly instead of synchronizing it through an effect.
    That makes disabling the gate immediate and avoids an unnecessary render for
    /mini, whose behavior must remain permanently enabled.
  */
  return { containerRef, isVisible: enabled ? observedVisibility : true };
}

export default function RoverMediaPlayer({
  roverId = null,
  sessionInfo = null,
  audioSessionInfo = null,
  videoMode = null,
  snapshotFeed = null,
  label,
  forceMute = false,
  sensors,
  pauseVideoWhenHidden = null,
}) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const configuredPauseHiddenRoverVideo = useSessionSelector(
    /*
      The server-normalized session policy is the browser source of truth. An
      exact true check also preserves the requested off-by-default behavior
      during initial session loading or when connected to an older payload.
    */
    (state) => state.session?.bandwidthSavings?.pauseHiddenRoverVideo === true,
  );
  const rosterEntry = useSessionSelector((state) =>
    effectiveRoverId && Array.isArray(state.session?.roster)
      ? state.session.roster.find((item) => String(item.id) === String(effectiveRoverId)) || null
      : null,
  );
  const hasAudio = hasRoverAudioCapture(rosterEntry);
  /*
    A surface-level override is retained for intentional exceptions. /mini sets
    false explicitly because its carousel depends on hidden players remaining
    warm; every normal player follows the server-configured bandwidth policy.
  */
  const shouldPauseVideoWhenHidden =
    typeof pauseVideoWhenHidden === 'boolean'
      ? pauseVideoWhenHidden
      : configuredPauseHiddenRoverVideo;
  const { containerRef, isVisible: isVideoVisible } = useVideoVisibilityGate(
    shouldPauseVideoWhenHidden,
  );
  const autoVideoEnabled = videoMode ? videoMode === 'whep' : true;
  const autoAudioEnabled = hasAudio;
  const autoVideoEntries = useMemo(
    () =>
      effectiveRoverId && autoVideoEnabled
        ? [{ type: 'rover', id: effectiveRoverId, key: effectiveRoverId }]
        : [],
    [effectiveRoverId, autoVideoEnabled],
  );
  const autoAudioEntries = useMemo(
    () =>
      effectiveRoverId && autoAudioEnabled
        ? [{ type: 'rover', id: `${effectiveRoverId}-audio`, key: `${effectiveRoverId}-audio` }]
        : [],
    [effectiveRoverId, autoAudioEnabled],
  );
  /*
    Video and audio requests must be separate here. A single combined request
    list would discard the dedicated audio session whenever visibility disables
    video, even though the rover publishes audio as an independent stream.
  */
  const autoVideoSources = useVideoRequests(autoVideoEntries, {
    enabled: Boolean(effectiveRoverId && autoVideoEnabled && isVideoVisible),
    version: mode,
  });
  const autoAudioSources = useVideoRequests(autoAudioEntries, {
    enabled: Boolean(effectiveRoverId && autoAudioEnabled),
    version: mode,
  });
  const resolvedSessionInfo =
    sessionInfo ?? (effectiveRoverId ? autoVideoSources[effectiveRoverId] || null : null);
  const resolvedAudioSessionInfo =
    audioSessionInfo ??
    (effectiveRoverId && hasAudio ? autoAudioSources[`${effectiveRoverId}-audio`] || null : null);
  const autoSnapshots = useRoverSnapshots(effectiveRoverId ? [effectiveRoverId] : [], {
    /* Snapshot delivery is video traffic too, so it follows the same visibility gate as WHEP. */
    enabled: Boolean(effectiveRoverId && isVideoVisible && !resolvedSessionInfo?.url),
    version: mode,
  });
  const resolvedSnapshotFeed =
    snapshotFeed ?? (effectiveRoverId ? autoSnapshots[effectiveRoverId] || null : null);
  const resolvedLabel =
    label || rosterEntry?.name || (effectiveRoverId ? `Rover ${effectiveRoverId}` : 'Rover');
  const mainBrushTelemetry = useTelemetrySelector(
    effectiveRoverId,
    selectMainBrushAudioTelemetry,
    mainBrushAudioTelemetryEqual,
  );
  const resolvedMainBrushTelemetry = sensors
    ? {
        mainBrushCurrentMa: sensors?.mainBrushCurrentMa ?? 0,
        mainBrushOvercurrent: Boolean(sensors?.wheelOvercurrents?.mainBrush),
      }
    : mainBrushTelemetry;
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const restartTimer = useRef(null);
  const audioRestartTimer = useRef(null);
  const audioPlayInterval = useRef(null);
  const unmuteTimer = useRef(null);
  const volumeFadeFrameRef = useRef(null);
  const appliedVolumeRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [audioStatus, setAudioStatus] = useState('idle');
  const [audioDetail, setAudioDetail] = useState(null);
  const [restartToken, setRestartToken] = useState(0);
  const [audioRestartToken, setAudioRestartToken] = useState(0);
  const [muted, setMuted] = useState(true);
  const hasDedicatedAudio = Boolean(resolvedAudioSessionInfo?.url);
  const usingSnapshot = videoMode === 'snapshot' || (!videoMode && !resolvedSessionInfo?.url);
  const { value: audioSettings } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const { value: videoSettings } = useSettingsNamespace('video', VIDEO_SETTINGS_DEFAULTS);
  const videoFilter = normalizeVideoFilter(videoSettings?.colorFilter);
  const videoFilterStyle = VIDEO_FILTER_STYLES[videoFilter];
  const mediaStyle = videoFilterStyle
    ? {
        // Apply the filter only to the camera pixels. The parent overlays remain unfiltered so
        // telemetry, chat, and warning text do not lose contrast or inherit the green tint.
        filter: videoFilterStyle,
      }
    : undefined;
  const masterVolume = Number.isFinite(audioSettings?.masterVolume)
    ? audioSettings.masterVolume
    : AUDIO_SETTINGS_DEFAULTS.masterVolume;
  const roverVolume = Number.isFinite(audioSettings?.roverVolume)
    ? audioSettings.roverVolume
    : AUDIO_SETTINGS_DEFAULTS.roverVolume;
  const mainBrushDuckEnabled =
    typeof audioSettings?.mainBrushDuckEnabled === 'boolean'
      ? audioSettings.mainBrushDuckEnabled
      : typeof audioSettings?.autoLevelEnabled === 'boolean'
      ? audioSettings.autoLevelEnabled
      : AUDIO_SETTINGS_DEFAULTS.mainBrushDuckEnabled;
  const mainBrushDuckAmount = Number.isFinite(audioSettings?.mainBrushDuckAmount)
    ? Math.max(0, Math.min(1, audioSettings.mainBrushDuckAmount))
    : AUDIO_SETTINGS_DEFAULTS.mainBrushDuckAmount;
  const baseRoverGain = Math.max(0, Math.min(1, masterVolume * roverVolume));
  const mainBrushActive = Boolean(
    (Number(resolvedMainBrushTelemetry?.mainBrushCurrentMa) || 0) > BRUSH_CURRENT_THRESHOLD_MA ||
      resolvedMainBrushTelemetry?.mainBrushOvercurrent,
  );
  const duckGain = mainBrushDuckEnabled && mainBrushActive ? 1 - mainBrushDuckAmount : 1;
  const effectiveRoverGain = Math.max(0, Math.min(1, baseRoverGain * duckGain));

  const debugAudio = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const params = new URLSearchParams(window.location.search);
    return params.has('debugAudio');
  }, []);

  const audioDebugStateRef = useRef({
    hasDedicatedAudio: false,
    audioUrl: null,
    mainBrushDuckEnabled: false,
    mainBrushDuckAmount: 0,
    mainBrushActive: false,
    baseRoverGain: 0,
    effectiveRoverGain: 0,
  });
  useEffect(() => {
    audioDebugStateRef.current = {
      hasDedicatedAudio,
      audioUrl: resolvedAudioSessionInfo?.url || null,
      mainBrushDuckEnabled,
      mainBrushDuckAmount,
      mainBrushActive,
      baseRoverGain,
      effectiveRoverGain,
    };
  }, [
    hasDedicatedAudio,
    resolvedAudioSessionInfo?.url,
    mainBrushDuckEnabled,
    mainBrushDuckAmount,
    mainBrushActive,
    baseRoverGain,
    effectiveRoverGain,
  ]);

  const logAudio = useCallback(
    (event, meta = {}) => {
      if (!debugAudio) return;
      const audioEl = audioRef.current;
      const state = audioDebugStateRef.current;
      const payload = {
        event,
        ts: Date.now(),
        roverLabel: resolvedLabel || null,
        hasDedicatedAudio: state.hasDedicatedAudio,
        audioUrl: state.audioUrl,
        mainBrushDuckEnabled: state.mainBrushDuckEnabled,
        mainBrushDuckAmount: state.mainBrushDuckAmount,
        mainBrushActive: state.mainBrushActive,
        baseRoverGain: state.baseRoverGain,
        effectiveRoverGain: state.effectiveRoverGain,
        element: audioEl
          ? {
              muted: audioEl.muted,
              volume: audioEl.volume,
              paused: audioEl.paused,
              ended: audioEl.ended,
              readyState: audioEl.readyState,
              networkState: audioEl.networkState,
            }
          : null,
        ...meta,
      };
      try {
        console.log(`[AudioDebug] ${event} ${JSON.stringify(payload)}`);
      } catch {
        console.log('[AudioDebug]', event, payload);
      }
    },
    [debugAudio, resolvedLabel],
  );

  useEffect(() => {
    logAudio('settings/update');
  }, [logAudio]);

  const scheduleRestart = useCallback(() => {
    clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => setRestartToken(Date.now()), RESTART_DELAY_MS);
  }, []);
  const scheduleAudioRestart = useCallback(() => {
    clearTimeout(audioRestartTimer.current);
    audioRestartTimer.current = setTimeout(() => setAudioRestartToken(Date.now()), RESTART_DELAY_MS);
  }, []);

  const ensurePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.muted = true;
      await video.play();
    } catch {
      // Autoplay might still be blocked; retry logic elsewhere will handle it.
    }
  }, []);

  const attemptUnmute = useCallback(
    (delay = 0) => {
      if (forceMute || hasDedicatedAudio) return;
      clearTimeout(unmuteTimer.current);

      const scheduleRetry = () => {
        clearTimeout(unmuteTimer.current);
        unmuteTimer.current = setTimeout(() => {
          if (!forceMute) {
            tryPlay();
          }
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
    [ensurePlayback, forceMute, hasDedicatedAudio],
  );

  useEffect(
    () => () => {
      clearTimeout(restartTimer.current);
      clearTimeout(audioRestartTimer.current);
      clearTimeout(unmuteTimer.current);
      clearInterval(audioPlayInterval.current);
      if (volumeFadeFrameRef.current) {
        cancelAnimationFrame(volumeFadeFrameRef.current);
        volumeFadeFrameRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (status === 'playing') {
      attemptUnmute(0);
    }
  }, [status, attemptUnmute]);

  useEffect(() => {
    if (usingSnapshot) {
      setStatus('snapshot');
      setDetail(null);
    }
  }, [usingSnapshot]);

  useEffect(() => {
    if (!isVideoVisible || usingSnapshot || !resolvedSessionInfo?.url || !videoRef.current) {
      return undefined;
    }
    let active = true;
    let player;
    const resetMuteId = setTimeout(() => setMuted(true), 0);
    const handleStatus = (nextStatus, info) => {
      if (!active) return;
      logAudio('video/status', { nextStatus, info: info || null });
      setStatus(nextStatus);
      setDetail(info || null);
      if (nextStatus === 'playing') {
        ensurePlayback();
      }
      if (['error', 'failed', 'disconnected', 'closed'].includes(nextStatus)) {
        scheduleRestart();
      }
    };

    player = new WhepPlayer({
      url: resolvedSessionInfo.url,
      token: resolvedSessionInfo.token,
      video: videoRef.current,
      receiveAudio: !hasDedicatedAudio,
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
  }, [
    usingSnapshot,
    isVideoVisible,
    resolvedSessionInfo?.url,
    resolvedSessionInfo?.token,
    restartToken,
    scheduleRestart,
    ensurePlayback,
    hasDedicatedAudio,
    logAudio,
    effectiveRoverId,
  ]);

  useEffect(() => {
    if (status === 'stopped' && resolvedSessionInfo?.url) {
      scheduleRestart();
    }
  }, [status, resolvedSessionInfo?.url, scheduleRestart]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || !resolvedAudioSessionInfo?.url) {
      logAudio('route/no-audio-url');
      appliedVolumeRef.current = null;
      return;
    }
    const targetVolume = Math.max(0, Math.min(1, effectiveRoverGain));
    const currentVolume =
      appliedVolumeRef.current == null
        ? Math.max(0, Math.min(1, audioEl.volume))
        : appliedVolumeRef.current;
    if (volumeFadeFrameRef.current) {
      cancelAnimationFrame(volumeFadeFrameRef.current);
      volumeFadeFrameRef.current = null;
    }
    if (targetVolume > currentVolume) {
      const startedAt = performance.now();
      const from = currentVolume;
      const delta = targetVolume - from;
      const tick = (ts) => {
        const progress = Math.min(1, (ts - startedAt) / DUCK_RELEASE_FADE_MS);
        const next = from + delta * progress;
        audioEl.volume = next;
        appliedVolumeRef.current = next;
        if (progress < 1) {
          volumeFadeFrameRef.current = requestAnimationFrame(tick);
        } else {
          volumeFadeFrameRef.current = null;
        }
      };
      volumeFadeFrameRef.current = requestAnimationFrame(tick);
    } else {
      audioEl.volume = targetVolume;
      appliedVolumeRef.current = targetVolume;
    }
    logAudio('route/direct', {
      elementVolume: targetVolume,
      duckEnabled: mainBrushDuckEnabled,
      mainBrushActive,
      duckAmount: mainBrushDuckAmount,
    });
  }, [
    resolvedAudioSessionInfo?.url,
    effectiveRoverGain,
    mainBrushDuckEnabled,
    mainBrushActive,
    mainBrushDuckAmount,
    logAudio,
  ]);

  useEffect(() => {
    if (!resolvedAudioSessionInfo?.url || !audioRef.current) {
      return undefined;
    }
    let active = true;
    let player;
    const handleStatus = (nextStatus, info) => {
      if (!active) return;
      logAudio('audio/status', { nextStatus, info: info || null });
      setAudioStatus(nextStatus);
      setAudioDetail(info || null);
      if (['error', 'failed'].includes(nextStatus)) {
        scheduleAudioRestart();
      }
    };

    player = new WhepPlayer({
      url: resolvedAudioSessionInfo.url,
      token: resolvedAudioSessionInfo.token,
      video: audioRef.current,
      audioOnly: true,
      onStatus: handleStatus,
    });

    player.start().catch((err) => {
      if (!active) return;
      setAudioStatus('error');
      setAudioDetail(err.message);
      scheduleAudioRestart();
    });

    return () => {
      active = false;
      player?.stop();
    };
  }, [
    resolvedAudioSessionInfo?.url,
    resolvedAudioSessionInfo?.token,
    audioRestartToken,
    scheduleAudioRestart,
    logAudio,
  ]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!resolvedAudioSessionInfo?.url || !audioEl) {
      clearInterval(audioPlayInterval.current);
      return undefined;
    }
    const shouldAttempt = ['connecting', 'connected', 'playing', 'paused'].includes(audioStatus);
    if (!shouldAttempt) {
      clearInterval(audioPlayInterval.current);
      return undefined;
    }

    const attemptPlay = async () => {
      const target = audioRef.current;
      if (!target) return;
      target.muted = false;
      if (!target.paused && !target.ended) return;
      logAudio('retry/play-attempt');
      target
        .play()
        .then(() => {
          logAudio('retry/play-ok');
          setAudioStatus((prev) =>
            ['error', 'failed', 'disconnected', 'closed'].includes(prev) ? prev : 'playing',
          );
          setAudioDetail(null);
        })
        .catch((err) => {
          logAudio('retry/play-fail', { error: err?.message });
          setAudioDetail((prev) => prev || err?.message || 'autoplay blocked');
        });
    };

    attemptPlay();
    audioPlayInterval.current = setInterval(attemptPlay, AUDIO_RETRY_MS);

    return () => clearInterval(audioPlayInterval.current);
  }, [resolvedAudioSessionInfo?.url, audioStatus, logAudio]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return undefined;

    const handlePlay = () => {
      logAudio('element/play');
      setAudioStatus((prev) => (prev === 'error' ? prev : 'playing'));
      setAudioDetail(null);
    };
    const handlePause = () => {
      logAudio('element/pause');
      setAudioStatus((prev) => {
        if (['error', 'failed', 'disconnected', 'closed', 'stopped'].includes(prev)) return prev;
        return 'paused';
      });
      setAudioDetail((prev) => prev || 'paused');
    };
    const handleEnded = () => {
      logAudio('element/ended');
      setAudioStatus((prev) => (prev === 'error' ? prev : 'stopped'));
      setAudioDetail((prev) => prev || 'ended');
    };
    const handleError = () => {
      const { error } = audioEl;
      const message = error?.message || 'audio error';
      logAudio('element/error', { error: message });
      setAudioStatus('error');
      setAudioDetail(message);
    };
    const handleWaiting = () => logAudio('element/waiting');
    const handleCanPlay = () => logAudio('element/canplay');
    const handleStalled = () => logAudio('element/stalled');

    audioEl.addEventListener('play', handlePlay);
    audioEl.addEventListener('pause', handlePause);
    audioEl.addEventListener('ended', handleEnded);
    audioEl.addEventListener('error', handleError);
    audioEl.addEventListener('waiting', handleWaiting);
    audioEl.addEventListener('canplay', handleCanPlay);
    audioEl.addEventListener('stalled', handleStalled);

    return () => {
      audioEl.removeEventListener('play', handlePlay);
      audioEl.removeEventListener('pause', handlePause);
      audioEl.removeEventListener('ended', handleEnded);
      audioEl.removeEventListener('error', handleError);
      audioEl.removeEventListener('waiting', handleWaiting);
      audioEl.removeEventListener('canplay', handleCanPlay);
      audioEl.removeEventListener('stalled', handleStalled);
    };
  }, [resolvedAudioSessionInfo?.url, logAudio]);

  const snapshotStatus = resolvedSnapshotFeed?.error
    ? `Error: ${resolvedSnapshotFeed.error}`
    : resolvedSnapshotFeed?.objectUrl
    ? 'snapshot'
    : resolvedSnapshotFeed?.status || 'waiting';
  const renderedStatus = usingSnapshot
    ? snapshotStatus
    : !resolvedSessionInfo?.url
    ? 'waiting'
    : status === 'error'
    ? `Error: ${detail || 'unknown'}`
    : detail
    ? `${status} (${detail})`
    : status;
  const renderedAudioStatus = resolvedAudioSessionInfo?.error
    ? `Error: ${resolvedAudioSessionInfo.error}`
    : !resolvedAudioSessionInfo?.url
    ? 'waiting'
    : audioStatus === 'error'
    ? `Error: ${audioDetail || 'unknown'}`
    : audioDetail
    ? `${audioStatus} (${audioDetail})`
    : audioStatus;
  const showConnectingOverlay =
    !usingSnapshot &&
    !resolvedSessionInfo?.error &&
    status !== 'playing';

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {usingSnapshot ? (
        resolvedSnapshotFeed?.objectUrl ? (
          <img
            src={resolvedSnapshotFeed.objectUrl}
            alt={resolvedLabel}
            className="h-full w-full object-contain"
            style={mediaStyle}
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-300">
            Waiting for frame…
          </div>
        )
      ) : (
        <video
          ref={videoRef}
          muted={forceMute || muted || hasDedicatedAudio}
          playsInline
          autoPlay
          controls={false}
          className="h-full w-full object-contain"
          style={mediaStyle}
        />
      )}
      {showConnectingOverlay ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45">
          <div className="rounded border border-slate-500/70 bg-black/70 px-3 py-1 text-sm font-semibold text-slate-100">
            Connecting to video....
          </div>
        </div>
      ) : null}
      <audio ref={audioRef} autoPlay hidden />
      <div className="pointer-events-none absolute left-1 top-1 z-20 font-medium text-slate-100 text-[0.65rem]">
        <div className="flex flex-col gap-0.5 leading-none">
          <span>Status: {renderedStatus}</span>
          {renderedAudioStatus ? <span>Audio: {renderedAudioStatus}</span> : null}
        </div>
      </div>
    </div>
  );
}
