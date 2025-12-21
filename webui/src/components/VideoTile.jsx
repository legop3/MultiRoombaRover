import { useCallback, useEffect, useRef, useState } from 'react';
import { WhepPlayer } from '../lib/whepPlayer.js';
import TopDownMap from './TopDownMap.jsx';
import { useHudMapSetting } from '../hooks/useHudMapSetting.js';

const RESTART_DELAY_MS = 2000;
const UNMUTE_RETRY_MS = 3000;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function formatNoteLabel(note) {
  if (typeof note !== 'number' || !Number.isFinite(note)) return '--';
  const name = NOTE_NAMES[note % 12] || '?';
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

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
  label,
  forceMute = false,
  telemetryFrame,
  batteryConfig,
  layoutFormat = 'desktop',
  hudVariant = 'default',
  driverLabel = null,
  songNote = null,
}) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const restartTimer = useRef(null);
  const audioRestartTimer = useRef(null);
  const unmuteTimer = useRef(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [audioStatus, setAudioStatus] = useState('idle');
  const [audioDetail, setAudioDetail] = useState(null);
  const [restartToken, setRestartToken] = useState(0);
  const [audioRestartToken, setAudioRestartToken] = useState(0);
  const [muted, setMuted] = useState(true);
  const sensors = telemetryFrame?.sensors;
  const batteryCharge = sensors?.batteryChargeMah ?? null;
  const desktopLayout = layoutFormat === 'desktop';
  const mobileHud = !desktopLayout;
  const [showHudMapDesktop, setShowHudMapDesktop] = useHudMapSetting();
  const showHudMap = mobileHud ? true : showHudMapDesktop;
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
  }, [sessionInfo?.url, sessionInfo?.token, restartToken, scheduleRestart, ensurePlayback]);

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
      setAudioStatus(nextStatus);
      setAudioDetail(info || null);
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

  const renderedStatus = !sessionInfo?.url
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
    <div className="flex flex-col gap-0.5">
      <div className="relative w-full overflow-hidden bg-black aspect-video">
        <video
          ref={videoRef}
          muted={forceMute || muted}
          playsInline
          autoPlay
          controls={false}
          className="h-full w-full object-contain"
        />
        <audio ref={audioRef} autoPlay hidden />
        <HudOverlay
          frame={telemetryFrame}
          sensors={sensors}
          label={label}
          status={renderedStatus}
          audioStatus={renderedAudioStatus}
          desktopLayout={desktopLayout}
          variant={hudVariant}
          driverLabel={driverLabel}
          battery={batteryVisual}
          songNote={songNote}
          showTopDown={showHudMap}
          mobileHud={mobileHud}
        />
        <OvercurrentOverlay motors={overcurrentMotors} />
        <LowBatteryOverlay charge={batteryCharge} config={batteryConfig} />
        {showVerticalBattery && batteryVisual.available ? (
          <BatteryBarVertical visual={batteryVisual} />
        ) : null}
      </div>
      {!showVerticalBattery && <BatteryBar visual={batteryVisual} />}
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
      <span className="mt-0.5 text-[0.65rem] font-semibold text-slate-100">{percentText}</span>
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
  variant = 'default',
  driverLabel = null,
  battery,
  songNote = null,
  showTopDown = false,
  mobileHud = false,
}) {
  const bumps = sensors?.bumpsAndWheelDrops || {};
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(interval);
  }, []);

  const pulse = frame?.receivedAt ? now - frame.receivedAt < 200 : false;

  if (variant === 'spectator') {
    const telemetryEntries = [
      ['Voltage', sensors?.voltageMv != null ? `${(sensors.voltageMv / 1000).toFixed(2)} V` : '--'],
      ['Current', sensors?.currentMa != null ? `${sensors.currentMa} mA` : '--'],
      ['Charge', sensors?.batteryChargeMah != null ? `${sensors.batteryChargeMah}` : '--'],
      ['OI', sensors?.oiMode?.label || '--'],
    ];
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="absolute left-1 top-1 bg-black/70 px-1 py-0.5 text-[0.65rem] font-medium text-slate-100">
          <span>Status: {status}</span>
          {audioStatus ? <div>Audio: {audioStatus}</div> : null}
        </div>
        {songNote != null ? (
          <div className="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.25 text-[0.65rem] font-semibold text-emerald-200">
            Song {formatNoteLabel(songNote)} <span className="text-slate-400">({songNote})</span>
          </div>
        ) : null}

        <div className="absolute left-1 top-1/2 flex -translate-y-1/2 flex-col gap-0.25 bg-black/70 px-1 py-0.75 text-[0.65rem] text-slate-100">
          <span className="text-[0.6rem] uppercase tracking-wide text-slate-400">Telemetry</span>
          {telemetryEntries.map(([labelText, value]) => (
            <span key={labelText} className="flex items-center justify-between gap-0.5">
              <span className="text-slate-400">{labelText}</span>
              <span className="font-semibold text-white">{value}</span>
            </span>
          ))}
        </div>

        <div className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 items-center gap-1 bg-black/80 px-1 py-0.5 text-[0.8rem] text-slate-100">
          <span className="font-semibold text-white">{label || 'Unnamed Rover'}</span>
          {driverLabel ? <span className="text-slate-300">• {driverLabel}</span> : null}
        </div>

      {showTopDown ? (
        <div
          className="pointer-events-none absolute right-1 top-1"
          style={{
            width: '240px',
            height: '240px',
            opacity: 0.7,
            transform: `scale(${mobileHud ? 0.55 : 0.7})`,
            transformOrigin: 'top right',
          }}
        >
          <TopDownMap sensors={sensors} size={240} overlay />
        </div>
      ) : null}
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="absolute left-1 top-1 bg-black/70 px-1 py-0.5 text-[0.65rem] font-medium text-slate-100">
        <span>Status: {status}</span>
        {audioStatus ? <div>Audio: {audioStatus}</div> : null}
      </div>
      {songNote != null ? (
        <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.25 text-[0.65rem] font-semibold text-emerald-200">
          Song {formatNoteLabel(songNote)} <span className="text-slate-400">({songNote})</span>
        </div>
      ) : null}
      <div className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5 bg-black/80 px-0.5 py-0.5 text-slate-100">
        <span>Rover: "{label || 'Unnamed Rover'}"</span>
        {/* <span>{pulse ? 'Sensors active' : 'No recent sensors'}</span> */}
        </div>

        {showTopDown ? (
          <div
            className="pointer-events-none absolute right-1 top-1"
            style={{
              width: '240px',
              height: '240px',
              opacity: 0.7,
              transform: `scale(${mobileHud ? 0.55 : 0.7})`,
              transformOrigin: 'top right',
            }}
          >
            <TopDownMap sensors={sensors} size={240} overlay />
          </div>
        ) : null}
      </div>
    );
  }

const OVERCURRENT_LABELS = {
  leftWheel: 'Left wheel',
  rightWheel: 'Right wheel',
  mainBrush: 'Main brush',
  sideBrush: 'Side brush',
};

function OvercurrentOverlay({ motors }) {
  if (!motors?.length) return null;
  const labels = motors.map((name) => OVERCURRENT_LABELS[name] || name);
  return (
    <div className="pointer-events-none absolute flex items-center justify-center bg-red-900/60 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-4">
      <div className="text-center text-4xl font-semibold text-white animate-pulse">
        <div>OVERCURRENT</div>
        <div className="mt-0.5 text-xl font-medium text-white">{labels.join(', ')}</div>
      </div>
    </div>
  );
}

// low battery overlay, change text based on warn / urgent. use percentage calculated same as BatteryBar. change text based on warn or urgent.
function LowBatteryOverlay({ charge, config }) {
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

  return (
    <div className="pointer-events-none absolute flex items-center justify-center bg-amber-900/60 top-10 left-1/2 -translate-x-1/2 p-4">
      <div className="text-center text-2xl font-semibold text-white animate-pulse">
        <div>{message}</div>
      </div>
    </div>
  );
}
