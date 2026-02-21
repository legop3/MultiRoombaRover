import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WhepPlayer } from '../lib/whepPlayer.js';
import TopDownMap from './TopDownMap.jsx';
import { useHudMapSetting } from '../hooks/useHudMapSetting.js';
import { useChat } from '../context/ChatContext.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import { AUDIO_SETTINGS_DEFAULTS } from '../settings/namespaces.js';
import SocialButton from './SocialButton.jsx';
import BatteryBar from './BatteryBar.jsx';
import { buildBatteryVisual } from '../lib/battery.js';

const RESTART_DELAY_MS = 2000;
const UNMUTE_RETRY_MS = 3000;
const AUDIO_RETRY_MS = 3000;
const AUDIO_DUCK_FACTOR = 0.55;
const BRUSH_CURRENT_THRESHOLD_MA = 40;
const COMPRESSOR_REDUCTION_ACTIVE_DB = -0.75;
const COMPRESSOR_SETTINGS = {
  threshold: -30,
  knee: 10,
  ratio: 8,
  attack: 0.002,
  release: 0.18,
};
const COMPRESSOR_MAKEUP_GAIN = 2.25;

export default function VideoTile({
  sessionInfo,
  audioSessionInfo,
  videoMode = 'whep',
  snapshotFeed = null,
  qualityNotice = null,
  label,
  forceMute = false,
  telemetryFrame,
  batteryConfig,
  layoutFormat = 'desktop',
  hudVariant = 'default',
  driverLabel = null,
  hudForceMap = false,
  hudMapPosition = 'top-center',
  hudLabelScale = 1,
  fitParent = false,
  overcurrentLimiter = null,
  showTurnCue = false,
  turnTimerText = null,
  turnSeconds = null,
  isActiveDriver = false,
  idleSkipSeconds = null,
}) {
  const { session } = useSession();
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const restartTimer = useRef(null);
  const audioRestartTimer = useRef(null);
  const audioPlayInterval = useRef(null);
  const unmuteTimer = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceNodeRef = useRef(null);
  const audioCompressorRef = useRef(null);
  const audioGainRef = useRef(null);
  const audioGraphConnectedRef = useRef(false);
  const reductionPollRef = useRef(null);
  const graphFailedRef = useRef(false);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [audioStatus, setAudioStatus] = useState('idle');
  const [audioDetail, setAudioDetail] = useState(null);
  const [levelIndicator, setLevelIndicator] = useState(null);
  const [restartToken, setRestartToken] = useState(0);
  const [audioRestartToken, setAudioRestartToken] = useState(0);
  const [muted, setMuted] = useState(true);
  const hasDedicatedAudio = Boolean(audioSessionInfo?.url);
  const usingSnapshot = videoMode === 'snapshot';
  const sensors = telemetryFrame?.sensors;
  const { value: audioSettings } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const masterVolume = Number.isFinite(audioSettings?.masterVolume)
    ? audioSettings.masterVolume
    : AUDIO_SETTINGS_DEFAULTS.masterVolume;
  const roverVolume = Number.isFinite(audioSettings?.roverVolume)
    ? audioSettings.roverVolume
    : AUDIO_SETTINGS_DEFAULTS.roverVolume;
  const autoLevelEnabled = typeof audioSettings?.autoLevelEnabled === 'boolean'
    ? audioSettings.autoLevelEnabled
    : AUDIO_SETTINGS_DEFAULTS.autoLevelEnabled;
  const autoLevelMode = audioSettings?.autoLevelMode === 'duck' ? 'duck' : 'compressor';
  const baseRoverGain = Math.max(0, Math.min(1, masterVolume * roverVolume));
  const batteryCharge = sensors?.batteryChargeMah ?? null;
  const desktopLayout = layoutFormat === 'desktop';
  const mobileHud = !desktopLayout;
  const effectiveHudMapPosition = mobileHud ? 'top-right' : hudMapPosition;
  const [showHudMapDesktop, setShowHudMapDesktop] = useHudMapSetting();
  const showHudMap = hudForceMap ? true : mobileHud ? true : showHudMapDesktop;
  const batteryVisual = buildBatteryVisual({ charge: batteryCharge, config: batteryConfig });
  // console.log('[BatteryBarDebug]', {
  //   frameSensors: sensors,
  //   batteryCharge,
  //   batteryCapacity,
  //   config: batteryConfig,
  // });
  const wheelOvercurrents = sensors?.wheelOvercurrents || null;
  const overcurrentMotors =
    wheelOvercurrents == null
      ? []
      : Object.entries(wheelOvercurrents)
          .filter(([, active]) => Boolean(active))
          .map(([key]) => key);
  const limiterCaps = overcurrentLimiter?.caps || null;
  const limiterGroups = overcurrentLimiter?.overcurrent?.groups || null;
  const debugAudio =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugAudio');
  const debugHud =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugHud');
  const limiterFill = useMemo(() => {
    if (!limiterCaps) return null;
    const driveCap = Number.isFinite(limiterCaps?.drive?.cap) ? limiterCaps.drive.cap : 1;
    const auxCap = Number.isFinite(limiterCaps?.aux?.cap) ? limiterCaps.aux.cap : 1;
    return Math.max(0, Math.min(1, 1 - Math.min(driveCap, auxCap)));
  }, [limiterCaps]);
  const limiterActive = Boolean(overcurrentLimiter?.isActive);
  const overlayMotors = overcurrentMotors.length ? overcurrentMotors : limiterActive ? ['limiter'] : [];
  const overlayFill = limiterFill ?? (overcurrentMotors.length ? 1 : 0);
  const overlayVisible = Boolean(overlayMotors.length);
  const brushOrVacuumActive = Boolean(
    (Number(sensors?.mainBrushCurrentMa) || 0) > BRUSH_CURRENT_THRESHOLD_MA ||
      (Number(sensors?.sideBrushCurrentMa) || 0) > BRUSH_CURRENT_THRESHOLD_MA ||
      sensors?.wheelOvercurrents?.mainBrush ||
      sensors?.wheelOvercurrents?.sideBrush,
  );
  const duckGain = autoLevelEnabled && autoLevelMode === 'duck' && brushOrVacuumActive ? AUDIO_DUCK_FACTOR : 1;
  const effectiveRoverGain = Math.max(0, Math.min(1, baseRoverGain * duckGain));
  const logAudio = useCallback(
    (event, meta = {}) => {
      if (!debugAudio) return;
      const audioEl = audioRef.current;
      const ctx = audioContextRef.current;
      const payload = {
        event,
        ts: Date.now(),
        roverLabel: label || null,
        hasDedicatedAudio,
        audioUrl: audioSessionInfo?.url || null,
        autoLevelEnabled,
        autoLevelMode,
        baseRoverGain,
        effectiveRoverGain,
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
        context: ctx
          ? {
              state: ctx.state,
              sampleRate: ctx.sampleRate,
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
    [
      debugAudio,
      label,
      hasDedicatedAudio,
      audioSessionInfo?.url,
      autoLevelEnabled,
      autoLevelMode,
      baseRoverGain,
      effectiveRoverGain,
    ],
  );
  const discordUrl =
    session?.socials?.find((entry) => {
      const key = String(entry?.id || entry?.label || '').toLowerCase();
      return key === 'discord';
    })?.url ||
    session?.discord?.invite ||
    null;

  useEffect(() => {
    if (!debugHud) return;
    console.log('[OvercurrentHUD]', {
      overlayVisible,
      overlayMotors,
      overlayFill,
      limiterActive,
      limiterCaps,
      limiterGroups,
      wheelOvercurrents,
    });
  }, [debugHud, overlayFill, overlayMotors, overlayVisible, limiterActive, limiterCaps, limiterGroups, wheelOvercurrents]);

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
  const ensureAudioGraph = useCallback(() => {
    if (graphFailedRef.current) return false;
    const audioEl = audioRef.current;
    if (!audioEl || typeof window === 'undefined') {
      return false;
    }
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (typeof AudioContextCtor !== 'function') {
        return false;
      }
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextCtor();
      }
      const ctx = audioContextRef.current;
      if (!audioSourceNodeRef.current) {
        audioSourceNodeRef.current = ctx.createMediaElementSource(audioEl);
      }
      if (!audioCompressorRef.current) {
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = COMPRESSOR_SETTINGS.threshold;
        compressor.knee.value = COMPRESSOR_SETTINGS.knee;
        compressor.ratio.value = COMPRESSOR_SETTINGS.ratio;
        compressor.attack.value = COMPRESSOR_SETTINGS.attack;
        compressor.release.value = COMPRESSOR_SETTINGS.release;
        audioCompressorRef.current = compressor;
        logAudio('graph/compressor-created', {
          threshold: compressor.threshold.value,
          knee: compressor.knee.value,
          ratio: compressor.ratio.value,
          attack: compressor.attack.value,
          release: compressor.release.value,
        });
      }
      if (!audioGainRef.current) {
        audioGainRef.current = ctx.createGain();
      }
      if (!audioGraphConnectedRef.current) {
        audioSourceNodeRef.current.disconnect();
        audioCompressorRef.current.disconnect();
        audioGainRef.current.disconnect();
        audioSourceNodeRef.current.connect(audioCompressorRef.current);
        audioCompressorRef.current.connect(audioGainRef.current);
        audioGainRef.current.connect(ctx.destination);
        audioGraphConnectedRef.current = true;
        logAudio('graph/connected');
      }
      return true;
    } catch {
      graphFailedRef.current = true;
      logAudio('graph/failed');
      return false;
    }
  }, [logAudio]);

  const resumeAudioContext = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'suspended') return;
    logAudio('context/resume-attempt');
    await ctx.resume().catch(() => {});
    if (
      ctx.state === 'running' &&
      autoLevelEnabled &&
      autoLevelMode === 'compressor' &&
      audioGainRef.current
    ) {
      const graphGain = Math.max(0, Math.min(4, effectiveRoverGain * COMPRESSOR_MAKEUP_GAIN));
      audioGainRef.current.gain.value = graphGain;
      logAudio('context/gain-restored', { gain: graphGain, baseGain: effectiveRoverGain });
    }
    logAudio('context/resume-result');
  }, [logAudio, autoLevelEnabled, autoLevelMode, effectiveRoverGain]);

  const forceUnlockCompressorAudio = useCallback(async () => {
    if (!audioSessionInfo?.url || !autoLevelEnabled || autoLevelMode !== 'compressor') return;
    const graphReady = ensureAudioGraph();
    if (!graphReady) {
      logAudio('unlock/no-graph');
      return;
    }
    await resumeAudioContext();
    const target = audioRef.current;
    const gainNode = audioGainRef.current;
    if (gainNode) {
      gainNode.gain.value = effectiveRoverGain;
    }
    if (!target) {
      logAudio('unlock/no-audio-element');
      return;
    }
    // Compressor mode uses graph-only output.
    target.volume = 0;
    target.muted = false;
    target
      .play()
      .then(() => logAudio('unlock/force-play-ok'))
      .catch((err) => logAudio('unlock/force-play-fail', { error: err?.message }));
  }, [
    audioSessionInfo?.url,
    autoLevelEnabled,
    autoLevelMode,
    ensureAudioGraph,
    resumeAudioContext,
    effectiveRoverGain,
    logAudio,
  ]);

  useEffect(() => {
    if (!audioSessionInfo?.url || !autoLevelEnabled || autoLevelMode !== 'compressor') {
      return undefined;
    }
    const interval = setInterval(() => {
      const ctx = audioContextRef.current;
      const statusActive = ['connecting', 'connected', 'playing', 'paused'].includes(audioStatus);
      if (!statusActive) return;
      if (!ctx || ctx.state !== 'running') {
        logAudio('unlock/interval');
        forceUnlockCompressorAudio();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [audioSessionInfo?.url, autoLevelEnabled, autoLevelMode, audioStatus, forceUnlockCompressorAudio, logAudio]);

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
      clearInterval(reductionPollRef.current);
      audioGraphConnectedRef.current = false;
      audioSourceNodeRef.current?.disconnect?.();
      audioCompressorRef.current?.disconnect?.();
      audioGainRef.current?.disconnect?.();
      if (audioContextRef.current?.state && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
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
    if (usingSnapshot || !sessionInfo?.url || !videoRef.current) {
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
      url: sessionInfo.url,
      token: sessionInfo.token,
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
  }, [usingSnapshot, sessionInfo?.url, sessionInfo?.token, restartToken, scheduleRestart, ensurePlayback, hasDedicatedAudio, logAudio]);

  useEffect(() => {
    if (status === 'stopped' && sessionInfo?.url) {
      scheduleRestart();
    }
  }, [status, sessionInfo?.url, scheduleRestart]);

  useEffect(() => {
    const audioEl = audioRef.current;
    clearInterval(reductionPollRef.current);
    reductionPollRef.current = null;
    if (!audioEl || !audioSessionInfo?.url) {
      setLevelIndicator(null);
      logAudio('route/no-audio-url');
      return;
    }

    const compressorMode = autoLevelEnabled && autoLevelMode === 'compressor';
    const duckMode = autoLevelEnabled && autoLevelMode === 'duck';
    const graphReady = compressorMode && ensureAudioGraph();

    if (graphReady) {
      const compressor = audioCompressorRef.current;
      const gainNode = audioGainRef.current;
      const contextRunning = audioContextRef.current?.state === 'running';
      // Compressor mode is graph-only: do not route direct element output.
      audioEl.volume = 0;
      logAudio('route/graph', { contextRunning, elementVolume: audioEl.volume });
      if (gainNode) {
        const graphGain = contextRunning
          ? Math.max(0, Math.min(4, effectiveRoverGain * COMPRESSOR_MAKEUP_GAIN))
          : 0;
        gainNode.gain.value = graphGain;
        logAudio('route/graph-gain', { graphGain, baseGain: effectiveRoverGain });
      }
      if (compressor) {
        compressor.threshold.value = COMPRESSOR_SETTINGS.threshold;
        compressor.knee.value = COMPRESSOR_SETTINGS.knee;
        compressor.ratio.value = COMPRESSOR_SETTINGS.ratio;
        compressor.attack.value = COMPRESSOR_SETTINGS.attack;
        compressor.release.value = COMPRESSOR_SETTINGS.release;
      }
      resumeAudioContext();
      reductionPollRef.current = setInterval(() => {
        if (audioContextRef.current?.state !== 'running') {
          setLevelIndicator(null);
          return;
        }
        const reduction = compressor?.reduction;
        if (typeof reduction === 'number' && reduction <= COMPRESSOR_REDUCTION_ACTIVE_DB) {
          const amount = Math.round(Math.abs(reduction) * 10) / 10;
          const formatted = Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1);
          setLevelIndicator(`Level: ${formatted}dB`);
          logAudio('compressor/reduction', { reduction, formatted });
        } else {
          setLevelIndicator(null);
        }
      }, 180);
      return;
    }

    audioEl.volume = effectiveRoverGain;
    logAudio('route/direct', { elementVolume: audioEl.volume, duckMode, brushOrVacuumActive });
    if (audioCompressorRef.current) {
      audioCompressorRef.current.threshold.value = 0;
      audioCompressorRef.current.knee.value = 0;
      audioCompressorRef.current.ratio.value = 1;
      audioCompressorRef.current.attack.value = 0.003;
      audioCompressorRef.current.release.value = 0.25;
    }
    if (audioGainRef.current) {
      // In direct route, silence graph output to avoid duplicate path.
      audioGainRef.current.gain.value = 0;
    }
    if (duckMode && brushOrVacuumActive) {
      setLevelIndicator('Level: ducking');
    } else {
      setLevelIndicator(null);
    }
  }, [
    audioSessionInfo?.url,
    autoLevelEnabled,
    autoLevelMode,
    brushOrVacuumActive,
    effectiveRoverGain,
    ensureAudioGraph,
    resumeAudioContext,
    logAudio,
  ]);

  // Audio-only WHEP (no pausing/muting; keeps trying to play)
  useEffect(() => {
    if (!audioSessionInfo?.url || !audioRef.current) {
      return undefined;
    }
    let active = true;
    let player;
    const handleStatus = (nextStatus, info) => {
      if (!active) return;
      logAudio('audio/status', { nextStatus, info: info || null });
      setAudioDetail(info || (nextStatus === 'connected' ? 'connected' : null));
      setAudioStatus((prev) => {
        if (nextStatus === 'connected' && (prev === 'playing' || prev === 'connecting')) {
          return prev;
        }
        if (nextStatus === 'new') {
          return prev;
        }
        return nextStatus;
      });
      if (nextStatus === 'playing') {
        resumeAudioContext();
        const target = audioRef.current;
        if (target) {
          target.muted = false;
          target.play().then(() => logAudio('audio/play-ok')).catch((err) => logAudio('audio/play-fail', { error: err?.message }));
        }
      }
      if (['error', 'failed'].includes(nextStatus)) {
        scheduleAudioRestart();
      }
    };

    player = new WhepPlayer({
      url: audioSessionInfo.url,
      token: audioSessionInfo.token,
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
    audioSessionInfo?.url,
    audioSessionInfo?.token,
    audioRestartToken,
    scheduleAudioRestart,
    resumeAudioContext,
    logAudio,
  ]);

  // Keep nudging the audio element to play in case autoplay was blocked.
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioSessionInfo?.url || !audioEl) {
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
      await resumeAudioContext();
      target
        .play()
        .then(() => {
          logAudio('retry/play-ok');
          setAudioStatus((prev) => (prev === 'connected' ? 'playing' : prev));
          setAudioDetail((prev) => (prev === 'paused' ? null : prev));
        })
        .catch((err) => {
          logAudio('retry/play-fail', { error: err?.message });
          setAudioDetail((prev) => prev || err?.message || 'autoplay blocked');
        });
    };

    attemptPlay();
    audioPlayInterval.current = setInterval(attemptPlay, AUDIO_RETRY_MS);

    return () => clearInterval(audioPlayInterval.current);
  }, [audioSessionInfo?.url, audioStatus, resumeAudioContext, logAudio]);

  // Reflect audio element events back into status/detail so the HUD stays accurate.
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
  }, [audioSessionInfo?.url, logAudio]);

  const snapshotStatus = snapshotFeed?.error
    ? `Error: ${snapshotFeed.error}`
    : snapshotFeed?.objectUrl
    ? 'snapshot'
    : snapshotFeed?.status || 'waiting';
  const renderedStatus = usingSnapshot
    ? snapshotStatus
    : !sessionInfo?.url
    ? 'waiting'
    : status === 'error'
    ? `Error: ${detail || 'unknown'}`
    : detail
    ? `${status} (${detail})`
    : status;
  const renderedAudioStatus = audioSessionInfo?.error
    ? `Error: ${audioSessionInfo.error}`
    : !audioSessionInfo?.url
    ? null
    : audioStatus === 'error'
    ? `Error: ${audioDetail || 'unknown'}`
    : audioDetail
    ? `${audioStatus} (${audioDetail})`
    : audioStatus;
  const showVerticalBattery = hudVariant === 'spectator';
  const noHud = hudVariant === 'none';

  return (
    <div className={`flex flex-col gap-0.5 ${fitParent ? 'h-full' : ''}`}>
      <div
        className={`relative w-full overflow-hidden bg-black ${fitParent ? 'h-full flex-1' : 'aspect-[4/3]'}`}
      >
        {usingSnapshot ? (
          snapshotFeed?.objectUrl ? (
            <img
              src={snapshotFeed.objectUrl}
              alt={label}
              className="h-full w-full object-contain"
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
          />
        )}
        <audio ref={audioRef} autoPlay hidden />
        {!noHud && showTurnCue ? (
          <TurnCueOverlay
            mobileHud={mobileHud}
            turnSeconds={turnSeconds}
            isActiveDriver={isActiveDriver}
            idleSkipSeconds={idleSkipSeconds}
          />
        ) : null}
        {!noHud ? (
          <HudOverlay
            frame={telemetryFrame}
            sensors={sensors}
            label={label}
            status={renderedStatus}
            audioStatus={renderedAudioStatus}
            levelStatus={levelIndicator}
            desktopLayout={desktopLayout}
            layoutFormat={layoutFormat}
            variant={hudVariant}
            driverLabel={driverLabel}
            battery={batteryVisual}
            showTopDown={showHudMap}
            mobileHud={mobileHud}
            mapPosition={effectiveHudMapPosition}
            turnTimerText={turnTimerText}
            labelScale={hudLabelScale}
          />
        ) : null}
        {!noHud ? <HudChatInput compact={mobileHud} /> : null}
        {!noHud && debugHud ? (
          <div className="pointer-events-none absolute left-1 top-1 z-40 rounded bg-black/80 px-1 py-0.5 text-[0.6rem] text-lime-200">
            {`OC vis:${overlayVisible ? 1 : 0} motors:${overlayMotors.length} fill:${Math.round(overlayFill * 100)}%`}
          </div>
        ) : null}
        {!noHud ? <OvercurrentOverlay motors={overlayMotors} fill={overlayFill} compact={mobileHud} /> : null}
        {!noHud ? <LowBatteryOverlay battery={batteryVisual} compact={mobileHud} /> : null}
        {!noHud && showVerticalBattery && batteryVisual.available ? (
          <div className="pointer-events-none absolute right-1 top-1/2 flex h-[70%] -translate-y-1/2 flex-col items-center justify-center rounded bg-black/60 px-0.5 pb-1 pt-1">
            <BatteryBar
              visual={batteryVisual}
              orientation="vertical"
              variant="inline"
              compact={mobileHud}
              className="h-full w-4"
            />
          </div>
        ) : null}
        {!noHud && qualityNotice ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
            <div
              className={`mx-auto w-fit rounded border border-amber-300/80 bg-black/75 text-amber-200 ${
                mobileHud ? 'px-2 py-1 text-[0.6rem]' : 'px-3 py-1.5 text-sm'
              }`}
            >
              <div className="text-center">{qualityNotice}</div>
              <div className="pointer-events-auto mt-0">
                <SocialButton
                  id="discord"
                  label="Join our Discord server while you wait!"
                  url={discordUrl}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {!noHud && !showVerticalBattery && (
        <div className="space-y-0.5">
          <LightBumpBars sensors={sensors} />
          <div className="panel-section space-y-0.5 text-sm">
            <BatteryBar visual={batteryVisual} compact={mobileHud} />
          </div>
        </div>
      )}
    </div>
  );
}

function LightBumpBars({ sensors }) {
  const values = [
    sensors?.lightBumpLeftSignal,
    sensors?.lightBumpFrontLeftSignal,
    sensors?.lightBumpCenterLeftSignal,
    sensors?.lightBumpCenterRightSignal,
    sensors?.lightBumpFrontRightSignal,
    sensors?.lightBumpRightSignal,
  ];
  const max = values.filter((v) => v != null).reduce((acc, v) => Math.max(acc, v), 1200);
  const eased = (v) => Math.pow(Math.max(0, Math.min(1, (v ?? 0) / max)), 0.35);
  const hueFor = (v) => {
    if (v == null || v <= 0) return 'hsl(200 60% 18%)';
    const h = (200 + eased(v) * 360) % 360;
    return `hsl(${h} 100% 60%)`;
  };
  const segments = 6;
  const gap = 2;
  const barHeight = 12;

  return (
    <div className="flex w-full items-center justify-center gap-0.5">
      {values.map((v, idx) => {
        const t = eased(v);
        const dir = idx < segments / 2 ? -1 : 1; // left bars fill left, right bars fill right
        const fill = `${t * 100}%`;
        const color = hueFor(v);
        return (
          <div key={idx} className="relative flex-1 min-w-[0]" style={{ height: `${barHeight}px` }}>
            <div className="h-full w-full overflow-hidden bg-slate-800" style={{ borderRadius: 0 }}>
              <div
                className="h-full"
                style={{
                  width: fill,
                  background: color,
                  float: dir === -1 ? 'right' : 'left',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HudOverlay({
  frame,
  sensors,
  label,
  status,
  audioStatus,
  levelStatus,
  desktopLayout = true,
  layoutFormat = 'desktop',
  variant = 'default',
  driverLabel = null,
  battery,
  showTopDown = false,
  mobileHud = false,
  mapPosition = 'top-center',
  turnTimerText = null,
  labelScale = 1,
}) {
  const bumps = sensors?.bumpsAndWheelDrops || {};
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(interval);
  }, []);

  const pulse = frame?.receivedAt ? now - frame.receivedAt < 200 : false;
  const isMobile = mobileHud;
  const portraitMobile = layoutFormat === 'mobile-portrait';
  const statusTextClass = isMobile ? 'text-[0.45rem]' : 'text-[0.65rem]';
  const statusPadClass = isMobile ? 'px-0.25 py-0.25' : 'px-1 py-0.5';
  const labelPadClass = isMobile ? 'px-0.25 py-0.25' : 'px-0.5 py-0.5';
  const labelTextClass = isMobile ? 'text-[0.55rem]' : 'text-[0.8rem]';
  const statusPosClass = isMobile ? 'left-0.5 top-0.5' : 'left-1 top-1';
  const timerTextClass = isMobile ? 'text-[0.5rem]' : 'text-[0.7rem]';
  const timerPadClass = isMobile ? 'px-0.5 py-0.25' : 'px-1 py-0.5';
  const telemetryPosClass = isMobile ? 'left-0.5 top-1/2' : 'left-1 top-1/2';
  const labelPosClass = isMobile ? 'bottom-0.5' : 'bottom-0.5';
  const labelWrapperStyle = {
    transform: `translateX(-50%) scale(${labelScale})`,
    transformOrigin: 'center bottom',
  };
  const mapSize = '240px';
  const mapScale = portraitMobile ? 0.3 : isMobile ? 0.33 : 0.7;
  const mapOpacity = isMobile ? 0.6 : 0.7;
  const mapStyle = {
    width: mapSize,
    height: mapSize,
    opacity: mapOpacity,
    transform: mapPosition === 'top-center' ? `translateX(-50%) scale(${mapScale})` : `scale(${mapScale})`,
    transformOrigin:
      mapPosition === 'bottom-left' ? 'bottom left' : mapPosition === 'top-center' ? 'top center' : 'top right',
    ...(mapPosition === 'bottom-left'
      ? { left: '0.25rem', bottom: '0.25rem' }
      : mapPosition === 'top-center'
        ? { left: '50%', top: '0.25rem' }
        : { right: '0.25rem', top: '0.25rem' }),
  };

  if (variant === 'none') {
    return null;
  }

  if (variant === 'spectator') {
    const telemetryEntries = [
      ['Voltage', sensors?.voltageMv != null ? `${(sensors.voltageMv / 1000).toFixed(2)} V` : '--'],
      ['Current', sensors?.currentMa != null ? `${sensors.currentMa} mA` : '--'],
      ['Charge', sensors?.batteryChargeMah != null ? `${sensors.batteryChargeMah}` : '--'],
      ['OI', sensors?.oiMode?.label || '--'],
    ];
    const docked = Boolean(sensors?.chargingSources?.homeBase);
    const chargingLabel = sensors?.chargingState?.label || '';
    const charging = Boolean(chargingLabel && chargingLabel.toLowerCase() !== 'not charging');
    const oiLabel = sensors?.oiMode?.label || 'Unknown';
    const oiNormalized = oiLabel.toLowerCase();
    const oiTone =
      oiNormalized === 'full'
        ? 'bg-emerald-500/80 text-emerald-50'
        : oiNormalized === 'safe'
          ? 'bg-amber-400/80 text-amber-950'
          : oiNormalized === 'passive'
            ? 'bg-slate-700/80 text-slate-100'
            : 'bg-slate-700/60 text-slate-200';
    const dockTone = docked ? 'bg-emerald-500/80 text-emerald-50' : 'bg-slate-700/70 text-slate-200';
    const chargingTone = charging
      ? 'bg-emerald-500/80 text-emerald-50'
      : docked
        ? 'bg-amber-400/80 text-amber-950'
        : 'bg-slate-700/70 text-slate-200';
    return (
      <>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className={`absolute ${statusPosClass} font-medium text-slate-100 ${statusTextClass}`}>
          <div className="flex flex-col gap-0.5 leading-none">
            <span>Status: {status}</span>
            {audioStatus ? <span>Audio: {audioStatus}</span> : null}
            {levelStatus ? <span className="text-cyan-300">{levelStatus}</span> : null}
          </div>
        </div>
          <div
            className={`absolute ${telemetryPosClass} flex -translate-y-1/2 flex-col gap-0.5 bg-black/70 text-slate-100 ${statusTextClass} ${statusPadClass}`}
          >
            <div className="space-y-0.5 leading-tight">
              <div className="flex flex-col gap-0.5 text-[0.75rem] font-semibold uppercase tracking-wide">
                <span className={`rounded px-1.5 py-0.5 ${dockTone}`}>{docked ? 'Docked' : 'Undocked'}</span>
                <span className={`rounded px-1.5 py-0.5 ${chargingTone}`}>
                  {charging ? 'Charging' : docked ? 'Not charging' : 'Not charging'}
                </span>
                <span className={`rounded px-1.5 py-0.5 ${oiTone}`}>OI: {oiLabel}</span>
              </div>
              {/* <span
                className={`${isMobile ? 'text-[0.45rem]' : 'text-[0.6rem]'} uppercase tracking-wide text-slate-400`}
              >
                Telemetry
              </span> */}
              {telemetryEntries.map(([labelText, value]) => (
                <span key={labelText} className="flex items-center justify-between gap-0.5">
                  <span className="text-slate-400">{labelText}</span>
                  <span className="font-semibold text-white">{value}</span>
                </span>
              ))}
            </div>
          </div>

          <div className={`absolute ${labelPosClass} left-1/2`} style={labelWrapperStyle}>
            <div
              className={`flex items-center gap-0.5 bg-black/80 text-slate-100 ${labelPadClass} ${labelTextClass}`}
            >
              <span className="font-semibold text-white">{label || 'Unnamed Rover'}</span>
              {driverLabel ? <span className="text-slate-300">• {driverLabel}</span> : null}
            </div>
          </div>
        </div>
        {showTopDown ? (
          <div
            className="pointer-events-none absolute rounded"
            style={{
              ...mapStyle,
            }}
          >
            <TopDownMap sensors={sensors} size={240} overlay />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className={`absolute ${statusPosClass} font-medium text-slate-100 ${statusTextClass}`}>
        <div className="flex flex-col gap-0.5 leading-none">
          <span>Status: {status}</span>
          {audioStatus ? <span>Audio: {audioStatus}</span> : null}
          {levelStatus ? <span className="text-cyan-300">{levelStatus}</span> : null}
        </div>
      </div>
      {turnTimerText ? (
        <div
          className={`absolute left-1/2 top-0.5 -translate-x-1/2 rounded bg-black/70 text-slate-100 ${timerPadClass} ${timerTextClass}`}
        >
          {turnTimerText}
        </div>
      ) : null}
      <div className={`absolute ${labelPosClass} left-1/2`} style={labelWrapperStyle}>
        <div className={`flex gap-0.5 bg-black/80 text-slate-100 ${labelPadClass} ${labelTextClass}`}>
          <span>Rover: "{label || 'Unnamed Rover'}"</span>
          {/* <span>{pulse ? 'Sensors active' : 'No recent sensors'}</span> */}
        </div>
      </div>

      {showTopDown && variant !== 'spectator' ? (
        <div
          className="pointer-events-none absolute rounded"
          style={{
            ...mapStyle,
            // padding: '0.1rem',
            // background: 'rgba(0,0,0,0.6)',
          }}
        >
          <TopDownMap sensors={sensors} size={240} overlay />
        </div>
      ) : null}
    </div>
  );
}

function TurnCueOverlay({
  mobileHud = false,
  turnSeconds = null,
  isActiveDriver = false,
  idleSkipSeconds = null,
}) {
  const titleClass = mobileHud ? 'text-3xl' : 'text-5xl';
  const subClass = mobileHud ? 'text-xs' : 'text-sm';
  const timerClass = mobileHud ? 'text-[0.55rem]' : 'text-[0.75rem]';
  const padClass = mobileHud ? 'px-4 py-3' : 'px-6 py-4';
  const showCountdown = isActiveDriver && typeof idleSkipSeconds === 'number';
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55">
      <div className={`flex flex-col items-center gap-0.5 rounded border border-amber-300/80 bg-black/70 ${padClass}`}>
        <div className={`font-semibold text-amber-200 ${titleClass}`}>IT IS YOUR TURN!</div>
        <div className={`text-amber-200/80 ${subClass}`}>Start driving!</div>
        {showCountdown ? (
          <div className={`text-red-100/90 ${timerClass}`}>
            Idle skip in {idleSkipSeconds}s
          </div>
        ) : null}
      </div>
    </div>
  );
}

const OVERCURRENT_LABELS = {
  leftWheel: 'Left wheel',
  rightWheel: 'Right wheel',
  mainBrush: 'Main brush',
  sideBrush: 'Side brush',
  limiter: 'Overcurrent limit',
};

function OvercurrentOverlay({ motors, fill = 0, compact = false }) {
  if (!motors?.length) return null;
  const safeLabels = motors.map((name) => OVERCURRENT_LABELS[name] || name);
  const containerClass = compact ? 'w-[12rem] h-[3.5rem]' : 'w-[20rem] h-[7rem]';
  const padClass = compact ? 'px-2 py-1' : 'px-4 py-2';
  const textClass = compact ? 'text-lg' : 'text-4xl';
  const subTextClass = compact ? 'text-xs' : 'text-xl';
  const safeFill = Math.max(0, Math.min(1, fill));
  const fillWidth = `${Math.round(safeFill * 100)}%`;
  return (
    <div
      className={`pointer-events-none absolute flex items-center justify-center bg-red-900/50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${containerClass}`}
    >
      <div className="relative h-full w-full">
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full bg-red-700/60" style={{ width: fillWidth }} />
        </div>
        <div className={`relative z-10 flex h-full w-full flex-col items-center justify-center text-center font-semibold text-white animate-pulse ${textClass} ${padClass}`}>
          <div>OVERCURRENT</div>
          <div className={`mt-0 font-medium text-white ${subTextClass}`}>{safeLabels.join(', ')}</div>
        </div>
      </div>
    </div>
  );
}

// low battery overlay, change text based on warn / urgent. use percentage calculated same as BatteryBar. change text based on warn or urgent.
function LowBatteryOverlay({ battery, compact = false }) {
  if (!battery?.available) return null;
  if (!battery.warnActive && !battery.urgentActive) return null;

  const message = battery.urgentActive
    ? 'BATTERY VERY LOW, DOCK THE ROVER AND CHARGE IMMEDIATELY!!'
    : 'Battery low! please dock and charge the rover soon.';

  const containerClass = compact ? 'p-2 top-6' : 'p-4 top-10';
  const textClass = compact ? 'text-sm' : 'text-2xl';

  return (
    <div
      className={`pointer-events-none absolute flex items-center justify-center bg-amber-900/60 left-1/2 -translate-x-1/2 ${containerClass}`}
    >
      <div className={`text-center font-semibold text-white animate-pulse ${textClass}`}>
        <div>{message}</div>
      </div>
    </div>
  );
}

function HudChatInput({ compact = false }) {
  const { session } = useSession();
  const { sendMessage, onInputFocus, onInputBlur, blurChat, registerInputRef, setTypingActive } = useChat();
  const { value: ttsSettings } = useSettingsNamespace('tts', { engine: 'flite', voice: 'rms', pitch: 50 });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const canChat = session?.role !== 'spectator';
  const hideHudChat = session?.role === 'spectator';
  const currentRoverId = session?.assignment?.roverId || null;
  const rover = useMemo(
    () => session?.roster?.find((entry) => String(entry.id) === String(currentRoverId)) || null,
    [currentRoverId, session?.roster],
  );
  const ttsSupported = Boolean(rover?.audio?.ttsEnabled);
  const ttsPayload = useMemo(() => {
    if (!ttsSupported) return null;
    const engine = ttsSettings?.engine === 'espeak' ? 'espeak' : 'flite';
    if (engine === 'espeak') {
      let pitch = Number.isFinite(ttsSettings?.pitch) ? Math.round(ttsSettings.pitch) : undefined;
      if (typeof pitch === 'number') {
        pitch = Math.max(0, Math.min(99, pitch));
      }
      return { speak: true, engine, pitch };
    }
    const voice = typeof ttsSettings?.voice === 'string' ? ttsSettings.voice : undefined;
    return { speak: true, engine, voice };
  }, [ttsSettings?.engine, ttsSettings?.pitch, ttsSettings?.voice, ttsSupported]);
  const containerClass = compact
    ? 'pointer-events-auto absolute bottom-0.5 right-0.5 flex w-[9rem] max-w-[70vw] items-center gap-0.5 rounded bg-black/70 px-0.4 py-0.2'
    : 'pointer-events-auto absolute bottom-1 right-1 flex w-[12rem] max-w-[70vw] items-center gap-0.5 rounded bg-black/70 px-0.5 py-0.25';
  const inputClass = compact
    ? 'min-w-0 flex-1 bg-transparent text-[0.55rem] text-slate-100 placeholder:text-slate-400 focus:outline-none'
    : 'min-w-0 flex-1 bg-transparent text-[0.7rem] text-slate-100 placeholder:text-slate-400 focus:outline-none';
  const buttonClass = compact
    ? 'rounded bg-cyan-500/80 px-0.35 py-0.2 text-[0.55rem] font-semibold text-black disabled:opacity-50'
    : 'rounded bg-cyan-500/80 px-0.5 py-0.25 text-[0.7rem] font-semibold text-black disabled:opacity-50';

  async function handleSend(event) {
    event.preventDefault();
    if (!canChat) return;
    const clean = draft.trim();
    if (!clean) return;
    setSending(true);
    try {
      await sendMessage(clean, ttsPayload);
      setDraft('');
      blurChat();
      setTypingActive(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  if (hideHudChat) return null;

  return (
    <form onSubmit={handleSend} className={containerClass}>
      <input
        className={inputClass}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          setTypingActive(Boolean(next.trim()));
        }}
        onFocus={(event) => {
          onInputFocus(event);
          setTypingActive(Boolean(draft.trim()));
        }}
        onBlur={(event) => {
          onInputBlur(event);
          setTypingActive(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !draft.trim()) {
            event.preventDefault();
            blurChat();
            setTypingActive(false);
          }
        }}
        ref={(el) => registerInputRef(el, { target: 'hud' })}
        placeholder={canChat ? 'Chat (TTS)' : 'Spectator'}
        disabled={!canChat}
      />
      <button
        type="submit"
        disabled={!canChat || sending}
        className={buttonClass}
      >
        Speak
      </button>
    </form>
  );
}
