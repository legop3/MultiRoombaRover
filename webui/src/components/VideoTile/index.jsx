// Video Tile
// Purpose: Defines the Video Tile module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WhepPlayer } from '../../lib/whepPlayer.js';
import { useHudMapSetting } from '../../hooks/useHudMapSetting.js';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { AUDIO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import SocialButton from '../SocialButton/index.jsx';
import BatteryBar from '../BatteryBar/index.jsx';
import { buildBatteryVisual } from '../../lib/battery.js';
import TurnCueOverlay from './TurnCueOverlay.jsx';
import HudOverlay from './HudOverlay.jsx';
import OvercurrentOverlay from './OvercurrentOverlay.jsx';
import LowBatteryOverlay from './LowBatteryOverlay.jsx';
import LightBumpBars from './LightBumpBars.jsx';
import HudChatInput from './HudChatInput.jsx';
import {
  RESTART_DELAY_MS,
  UNMUTE_RETRY_MS,
  AUDIO_RETRY_MS,
  BRUSH_CURRENT_THRESHOLD_MA,
  DUCK_RELEASE_FADE_MS,
} from './constants.js';

export default function VideoTile({
  sessionInfo,
  audioSessionInfo,
  videoMode = 'whep',
  snapshotFeed = null,
  qualityNotice = null,
  label,
  roverColor = null,
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
  isActiveDriver = false,
  idleSkipSeconds = null,
}) {
  const session = useSessionSelector((state) => state.session);
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
  const batteryCharge = sensors?.batteryChargeMah ?? null;
  const desktopLayout = layoutFormat === 'desktop';
  const mobileHud = !desktopLayout;
  const effectiveHudMapPosition = mobileHud ? 'top-right' : hudMapPosition;
  const [showHudMapDesktop] = useHudMapSetting();
  const showHudMap = hudForceMap ? true : mobileHud ? true : showHudMapDesktop;
  const batteryVisual = buildBatteryVisual({ charge: batteryCharge, config: batteryConfig });
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
  const mainBrushActive = Boolean(
    (Number(sensors?.mainBrushCurrentMa) || 0) > BRUSH_CURRENT_THRESHOLD_MA ||
      sensors?.wheelOvercurrents?.mainBrush,
  );
  const duckGain = mainBrushDuckEnabled && mainBrushActive ? 1 - mainBrushDuckAmount : 1;
  const effectiveRoverGain = Math.max(0, Math.min(1, baseRoverGain * duckGain));
  const levelIndicator =
    mainBrushDuckEnabled && mainBrushActive && mainBrushDuckAmount > 0
      ? `Volume decreased ${Math.round(mainBrushDuckAmount * 1000) / 10}%`
      : null;
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
      audioUrl: audioSessionInfo?.url || null,
      mainBrushDuckEnabled,
      mainBrushDuckAmount,
      mainBrushActive,
      baseRoverGain,
      effectiveRoverGain,
    };
  }, [
    hasDedicatedAudio,
    audioSessionInfo?.url,
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
        roverLabel: label || null,
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
    [debugAudio, label],
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
    if (!audioEl || !audioSessionInfo?.url) {
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
    audioSessionInfo?.url,
    effectiveRoverGain,
    mainBrushDuckEnabled,
    mainBrushActive,
    mainBrushDuckAmount,
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
  }, [
    audioSessionInfo?.url,
    audioStatus,
    logAudio,
  ]);

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
            isActiveDriver={isActiveDriver}
            idleSkipSeconds={idleSkipSeconds}
          />
        ) : null}
        {!noHud ? (
          <HudOverlay
            sensors={sensors}
            label={label}
            roverColor={roverColor}
            status={renderedStatus}
            audioStatus={renderedAudioStatus}
            levelStatus={levelIndicator}
            layoutFormat={layoutFormat}
            variant={hudVariant}
            driverLabel={driverLabel}
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
