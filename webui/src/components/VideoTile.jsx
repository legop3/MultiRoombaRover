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
  const overcurrentActive = overcurrentMotors.length > 0;

  const scheduleRestart = useCallback(() => {
    clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => setRestartToken(Date.now()), RESTART_DELAY_MS);
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
    [forceMute],
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
  }, [sessionInfo?.url, sessionInfo?.token, restartToken, scheduleRestart]);

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
    <div className="flex flex-col gap-1">
      <div className="relative w-full overflow-hidden rounded-sm bg-black aspect-video">
        <video
          ref={videoRef}
          muted={forceMute || muted}
          playsInline
          autoPlay
          controls={false}
          className="h-full w-full object-contain"
        />
        <HudOverlay frame={telemetryFrame} session={sessionInfo}/>
        <OvercurrentOverlay motors={overcurrentMotors} />
      </div>
      <BatteryBar charge={batteryCharge} config={batteryConfig} label={label} status={renderedStatus} />
    </div>
  );
}

function BatteryBar({ charge, config, label, status }) {
  const full = config?.Full;
  const warn = config?.Warn;
  const urgent = config?.Urgent ?? null;
  if (charge == null || full == null || warn == null) {
    return (
      <div className="rounded-sm bg-[#1e1e1e] px-1 py-1 text-sm text-slate-200">
        <div className="flex items-center justify-between text-xs text-slate-400">
          {/* <span>{label}</span> */}
          <span>{status}</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">Battery telemetry unavailable</p>
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
    <div className="space-y-2 rounded-sm bg-[#1e1e1e] px-1 py-1 text-sm text-slate-200">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{status}</span>
      </div>
      <div className="relative h-4 w-full rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-[width] ${barClass}`} style={{ width: `${percentDisplay}%` }} />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-black/80">
          {percentText}
        </span>
      </div>
    </div>
  );
}

function HudOverlay({ frame, session }) {
  const sensors = frame?.sensors;
  const bumps = sensors?.bumpsAndWheelDrops || {};
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(interval);
  }, []);

  const pulse = frame?.receivedAt ? now - frame.receivedAt < 200 : false;

  // const bumperBadges = [
  //   { label: 'B-L', active: bumps.bumpLeft },
  //   { label: 'B-R', active: bumps.bumpRight },
  // ];
  // const wheelBadges = [
  //   { label: 'Drop L', active: bumps.wheelDropLeft },
  //   { label: 'Drop R', active: bumps.wheelDropRight },
  // ];
  // console.log('session', session);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 text-[0.55rem] text-slate-400">
          <span className={`h-2 w-2 rounded-full ${pulse ? 'bg-emerald-300 shadow-[0_0_4px_rgba(16,185,129,0.8)]' : 'bg-slate-700'}`} />
          <span>sensor</span>
        </div>
        <div className="flex gap-1">
          {bumperBadges.map((badge) => (
            <HudBadge key={badge.label} label={badge.label} active={badge.active} />
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-1">
        {wheelBadges.map((badge) => (
          <HudBadge key={badge.label} label={badge.label} active={badge.active} />
        ))}
      </div> */}
      {/* status that tells you the name of your rover */}



      {/* bump and wheel drops bar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1 rounded-full bg-gray-900/40 text-[0.55rem] font-medium">
        <div className={`px-0.5 rounded-full ${bumps.bumpLeft ? 'bg-red-500 text-white animate-pulse' : 'bg-black/40 text-slate-500'}`}>
          Left Bump
        </div>
        {/* left wheel drop */}
        <div className={`px-0.5 rounded-full ${bumps.wheelDropLeft ? 'bg-red-500 text-white animate-pulse' : 'bg-black/40 text-slate-500'}`}>
          Left Wheel Drop
        </div>
        {/* right wheel drop */}
        <div className={`px-0.5 rounded-full ${bumps.wheelDropRight ? 'bg-red-500 text-white animate-pulse' : 'bg-black/40 text-slate-500'}`}>
          Right Wheel Drop
        </div>
        {/* right bump */}
        <div className={`px-0.5 rounded-full ${bumps.bumpRight ? 'bg-red-500 text-white animate-pulse' : 'bg-black/40 text-slate-500'}`}>
          Right Bump
        </div>
      </div>
    </div>
  );
}

// function HudBadge({ label, active }) {
//   return (
//     <span
//       className={`rounded-sm px-1 py-0.5 text-[0.55rem] ${active ? 'bg-emerald-500/30 text-emerald-100' : 'bg-black/40 text-slate-500'}`}
//     >
//       {label}
//     </span>
//   );
// }

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
        <div className="mt-1 text-xl font-medium text-white">{labels.join(', ')}</div>
      </div>
    </div>
  );
}
