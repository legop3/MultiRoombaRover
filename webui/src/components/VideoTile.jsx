import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WhepPlayer } from '../lib/whepPlayer.js';
import TopDownMap from './TopDownMap.jsx';
import { useHudMapSetting } from '../hooks/useHudMapSetting.js';
import { useChat } from '../context/ChatContext.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import DiscordInviteButton from './DiscordInviteButton.jsx';

const RESTART_DELAY_MS = 2000;
const UNMUTE_RETRY_MS = 3000;
const AUDIO_RETRY_MS = 3000;

function buildBatteryVisual(charge, config) {
  const full = config?.Full;
  const warn = config?.Warn;
  const urgent = config?.Urgent ?? null;
  if (charge == null || full == null || warn == null) {
    return { available: false };
  }

  const span = full - warn;
  if (span <= 0) return { available: false };
  const normalized = (charge - warn) / span;
  const percent = Math.min(1, Math.max(0, normalized));
  const percentDisplay = Math.round(percent * 100);
  const depleted = normalized <= 0;
  const warnTriggered = urgent != null && charge <= urgent;
  const barClass = depleted ? 'bg-red-500 animate-pulse' : warnTriggered ? 'bg-amber-400' : 'bg-emerald-500';

  return {
    available: true,
    percentDisplay,
    depleted,
    warnTriggered,
    barClass,
  };
}

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
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const restartTimer = useRef(null);
  const audioRestartTimer = useRef(null);
  const audioPlayInterval = useRef(null);
  const unmuteTimer = useRef(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [audioStatus, setAudioStatus] = useState('idle');
  const [audioDetail, setAudioDetail] = useState(null);
  const [restartToken, setRestartToken] = useState(0);
  const [audioRestartToken, setAudioRestartToken] = useState(0);
  const [muted, setMuted] = useState(true);
  const usingSnapshot = videoMode === 'snapshot';
  const sensors = telemetryFrame?.sensors;
  const batteryCharge = sensors?.batteryChargeMah ?? null;
  const desktopLayout = layoutFormat === 'desktop';
  const mobileHud = !desktopLayout;
  const [showHudMapDesktop, setShowHudMapDesktop] = useHudMapSetting();
  const showHudMap = hudForceMap ? true : mobileHud ? true : showHudMapDesktop;
  const batteryVisual = buildBatteryVisual(batteryCharge, batteryConfig);
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
      if (forceMute) return;
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
    [ensurePlayback, forceMute],
  );

  useEffect(
    () => () => {
      clearTimeout(restartTimer.current);
      clearTimeout(audioRestartTimer.current);
      clearTimeout(unmuteTimer.current);
      clearInterval(audioPlayInterval.current);
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
  }, [usingSnapshot, sessionInfo?.url, sessionInfo?.token, restartToken, scheduleRestart, ensurePlayback]);

  useEffect(() => {
    if (status === 'stopped' && sessionInfo?.url) {
      scheduleRestart();
    }
  }, [status, sessionInfo?.url, scheduleRestart]);

  // Audio-only WHEP (no pausing/muting; keeps trying to play)
  useEffect(() => {
    if (!audioSessionInfo?.url || !audioRef.current) {
      return undefined;
    }
    let active = true;
    let player;
    const handleStatus = (nextStatus, info) => {
      if (!active) return;
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
        audioRef.current?.play().catch(() => {});
      }
      if (['error', 'failed', 'disconnected', 'closed'].includes(nextStatus)) {
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
  }, [audioSessionInfo?.url, audioSessionInfo?.token, audioRestartToken, scheduleAudioRestart]);

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

    const attemptPlay = () => {
      const target = audioRef.current;
      if (!target) return;
      if (!target.paused && !target.ended) return;
      target
        .play()
        .then(() => {
          setAudioStatus((prev) => (prev === 'connected' ? 'playing' : prev));
          setAudioDetail((prev) => (prev === 'paused' ? null : prev));
        })
        .catch((err) => {
          setAudioDetail((prev) => prev || err?.message || 'autoplay blocked');
        });
    };

    attemptPlay();
    audioPlayInterval.current = setInterval(attemptPlay, AUDIO_RETRY_MS);

    return () => clearInterval(audioPlayInterval.current);
  }, [audioSessionInfo?.url, audioStatus]);

  // Reflect audio element events back into status/detail so the HUD stays accurate.
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return undefined;

    const handlePlay = () => {
      setAudioStatus((prev) => (prev === 'error' ? prev : 'playing'));
      setAudioDetail(null);
    };
    const handlePause = () => {
      setAudioStatus((prev) => {
        if (['error', 'failed', 'disconnected', 'closed', 'stopped'].includes(prev)) return prev;
        return 'paused';
      });
      setAudioDetail((prev) => prev || 'paused');
    };
    const handleEnded = () => {
      setAudioStatus((prev) => (prev === 'error' ? prev : 'stopped'));
      setAudioDetail((prev) => prev || 'ended');
    };
    const handleError = () => {
      const { error } = audioEl;
      const message = error?.message || 'audio error';
      setAudioStatus('error');
      setAudioDetail(message);
    };

    audioEl.addEventListener('play', handlePlay);
    audioEl.addEventListener('pause', handlePause);
    audioEl.addEventListener('ended', handleEnded);
    audioEl.addEventListener('error', handleError);

    return () => {
      audioEl.removeEventListener('play', handlePlay);
      audioEl.removeEventListener('pause', handlePause);
      audioEl.removeEventListener('ended', handleEnded);
      audioEl.removeEventListener('error', handleError);
    };
  }, [audioSessionInfo?.url]);

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
            muted={forceMute || muted}
            playsInline
            autoPlay
            controls={false}
            className="h-full w-full object-contain"
          />
        )}
        <audio ref={audioRef} autoPlay hidden />
        {showTurnCue ? (
          <TurnCueOverlay
            mobileHud={mobileHud}
            turnSeconds={turnSeconds}
            isActiveDriver={isActiveDriver}
            idleSkipSeconds={idleSkipSeconds}
          />
        ) : null}
        <HudOverlay
          frame={telemetryFrame}
          sensors={sensors}
          label={label}
          status={renderedStatus}
          audioStatus={renderedAudioStatus}
          desktopLayout={desktopLayout}
          layoutFormat={layoutFormat}
          variant={hudVariant}
          driverLabel={driverLabel}
          battery={batteryVisual}
          showTopDown={showHudMap}
          mobileHud={mobileHud}
          mapPosition={hudMapPosition}
          turnTimerText={turnTimerText}
          labelScale={hudLabelScale}
        />
        <HudChatInput compact={mobileHud} />
        {debugHud ? (
          <div className="pointer-events-none absolute left-1 top-1 z-40 rounded bg-black/80 px-1 py-0.5 text-[0.6rem] text-lime-200">
            {`OC vis:${overlayVisible ? 1 : 0} motors:${overlayMotors.length} fill:${Math.round(overlayFill * 100)}%`}
          </div>
        ) : null}
        <OvercurrentOverlay motors={overlayMotors} fill={overlayFill} compact={mobileHud} />
        <LowBatteryOverlay charge={batteryCharge} config={batteryConfig} compact={mobileHud} />
        {showVerticalBattery && batteryVisual.available ? (
          <BatteryBarVertical visual={batteryVisual} />
        ) : null}
        {qualityNotice ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
            <div
              className={`mx-auto w-fit rounded border border-amber-300/80 bg-black/75 text-amber-200 ${
                mobileHud ? 'px-2 py-1 text-[0.6rem]' : 'px-3 py-1.5 text-sm'
              }`}
            >
              <div className="text-center">{qualityNotice}</div>
              <div className="pointer-events-auto mt-0">
                <DiscordInviteButton text={'Join our Discord server while you wait!'} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {!showVerticalBattery && (
        <div className="space-y-0.5">
          <LightBumpBars sensors={sensors} />
          <BatteryBar visual={batteryVisual} />
        </div>
      )}
    </div>
  );
}

function BatteryBar({ visual }) {
  if (!visual?.available) {
    return (
      <div className="panel-section space-y-0.5 text-sm">
        <p className="text-xs text-slate-500">Battery telemetry unavailable</p>
      </div>
    );
  }
  const percentText = `${visual.percentDisplay}%`;
  const barClass = visual.barClass;
  return (
    <div className="panel-section space-y-0.5 text-sm">
      <div className="relative h-4 w-full bg-zinc-900 flex">
        <div className={`h-full transition-[width] ${barClass}`} style={{ width: `${visual.percentDisplay}%` }}>
          <span className="inset-0 flex items-center justify-center text-xs font-semibold text-black/80">
            Battery {percentText}
          </span>
        </div>
      </div>
    </div>
  );
}

function BatteryBarVertical({ visual }) {
  if (!visual?.available) return null;
  const percentText = `${visual.percentDisplay}%`;
  return (
    <div className="pointer-events-none absolute right-1 top-1/2 flex h-[70%] -translate-y-1/2 flex-col items-center justify-end rounded bg-black/60 px-0.5 pb-1 pt-1">
      <div className="flex h-full w-4 items-end overflow-hidden rounded bg-zinc-900">
        <div
          className={`${visual.barClass} w-full transition-[height]`}
          style={{ height: `${visual.percentDisplay}%` }}
        />
      </div>
      <span className="mt-0 text-[0.65rem] font-semibold text-slate-100">{percentText}</span>
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
  const mapScale = portraitMobile ? 0.36 : isMobile ? 0.45 : 0.7;
  const mapOpacity = isMobile ? 0.85 : 0.7;
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
function LowBatteryOverlay({ charge, config, compact = false }) {
  if (charge == null || config == null) return null;
  const full = config.Full;
  const warn = config.Warn;
  const urgent = config.Urgent ?? null;
  const span = full - warn;
  if (span <= 0) return null;
  const normalized = (charge - warn) / span;
  const percent = Math.min(1, Math.max(0, normalized));
  const depleted = normalized <= 0;
  const warnTriggered = urgent != null && charge <= urgent;
  if (!warnTriggered && !depleted) return null;

  const message = depleted ? 'Battery low! please dock and charge the rover soon.' : 'BATTERY VERY LOW, PLEASE DOCK THE ROVER AND CHARGE IMMEDIATELY!!';

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
