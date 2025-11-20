import { useCallback, useEffect, useRef, useState } from 'react';
import { WhepPlayer } from '../lib/whepPlayer.js';

const RESTART_DELAY_MS = 2000;
const UNMUTE_RETRY_MS = 3000;

export default function VideoTile({ sessionInfo, label, forceMute = false, telemetryFrame, batteryConfig }) {
  const videoRef = useRef(null);
  const restartTimer = useRef(null);
  const unmuteTimer = useRef(null);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [restartToken, setRestartToken] = useState(0);
  const [muted, setMuted] = useState(true);
  const sensors = telemetryFrame?.sensors;
  const batteryCharge = sensors?.batteryChargeMah ?? null;
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

  const renderedStatus = !sessionInfo?.url
    ? 'waiting'
    : status === 'error'
    ? `Error: ${detail || 'unknown'}`
    : detail
    ? `${status} (${detail})`
    : status;

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
        <HudOverlay frame={telemetryFrame} label={label}/>
        <OvercurrentOverlay motors={overcurrentMotors} />
        <LowBatteryOverlay charge={batteryCharge} config={batteryConfig} />
      </div>
      <BatteryBar charge={batteryCharge} config={batteryConfig} status={renderedStatus} />
    </div>
  );
}

function BatteryBar({ charge, config, status }) {
  const full = config?.Full;
  const warn = config?.Warn;
  const urgent = config?.Urgent ?? null;
  if (charge == null || full == null || warn == null) {
    return (
      <div className="panel-section space-y-0.5 text-sm">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{status}</span>
        </div>
        <p className="text-xs text-slate-500">Battery telemetry unavailable</p>
      </div>
    );
  }

  const span = full - warn;
  if (span <= 0) return null;
  const normalized = (charge - warn) / span;
  const percent = Math.min(1, Math.max(0, normalized));
  const percentDisplay = Math.round(percent * 100);
  const percentText = `${percentDisplay}%`;
  const depleted = normalized <= 0;
  const warnTriggered = urgent != null && charge <= urgent;
  const barClass = depleted ? 'bg-red-500 animate-pulse' : warnTriggered ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="panel-section space-y-0.5 text-sm">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{status}</span>
      </div>
      <div className="relative h-4 w-full bg-zinc-900">
        <div className={`h-full transition-[width] ${barClass}`} style={{ width: `${percentDisplay}%` }} />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-black/80">
          Battery {percentText}
        </span>
      </div>
    </div>
  );
}

function HudOverlay({ frame, label }) {
  const sensors = frame?.sensors;
  const bumps = sensors?.bumpsAndWheelDrops || {};
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(interval);
  }, []);

  const pulse = frame?.receivedAt ? now - frame.receivedAt < 200 : false;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5 bg-black/80 px-0.5 py-0.5 text-xs text-slate-100">
        <span>You are driving: {label || 'Unnamed Rover'}</span>
        {/* <span>{pulse ? 'Sensors active' : 'No recent sensors'}</span> */}
      </div>


      {/* bump and wheel drops bar */}
      <div className="absolute top-0.5 left-1/2 flex -translate-x-1/2 gap-0.5 bg-black/70 px-0.5 py-0.5 text-[0.6rem] font-medium text-slate-200">
        <div className={`px-0.5 py-0.5 ${bumps.bumpLeft ? 'bg-red-600 text-white animate-pulse' : 'text-slate-500'}`}>Left bump</div>
        <div className={`px-0.5 py-0.5 ${bumps.wheelDropLeft ? 'bg-red-600 text-white animate-pulse' : 'text-slate-500'}`}>Left wheel drop</div>
        <div className={`px-0.5 py-0.5 ${bumps.wheelDropRight ? 'bg-red-600 text-white animate-pulse' : 'text-slate-500'}`}>Right wheel drop</div>
        <div className={`px-0.5 py-0.5 ${bumps.bumpRight ? 'bg-red-600 text-white animate-pulse' : 'text-slate-500'}`}>Right bump</div>
      </div>
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
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-red-900/60">
      <div className="text-center text-2xl font-semibold text-white animate-pulse">
        <div>Overcurrent</div>
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

  const message = depleted ? 'BATTERY VERY LOW, PLEASE DOCK THE ROVER AND CHARGE IMMEDIATELY!!' : 'Battery low! please dock and charge the rover soon.';

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-amber-900/60">
      <div className="text-center text-2xl font-semibold text-white animate-pulse">
        <div>{message}</div>
      </div>
    </div>
  );
}