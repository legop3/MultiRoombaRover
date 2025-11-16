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
  const batteryCapacity = sensors?.batteryCapacityMah ?? null;
  const wheelOvercurrents = sensors?.wheelOvercurrents || null;
  const overcurrentActive = Boolean(
    wheelOvercurrents && Object.values(wheelOvercurrents).some((value) => Boolean(value)),
  );

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
      <div className="relative w-full overflow-hidden rounded-sm bg-black">
        <video
          ref={videoRef}
          muted={forceMute || muted}
          playsInline
          autoPlay
          controls={false}
          className="h-full w-full object-contain"
        />
        <HudOverlay frame={telemetryFrame} />
        <OvercurrentOverlay active={overcurrentActive} />
      </div>
      <BatteryBar charge={batteryCharge} capacity={batteryCapacity} config={batteryConfig} label={label} status={renderedStatus} />
    </div>
  );
}

function BatteryBar({ charge, capacity, config, label, status }) {
  if (charge == null || !config?.full || config.warn == null) {
    return (
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{status}</span>
      </div>
    );
  }
  const span = config.full - config.warn;
  if (span <= 0) return null;
  const normalized = (charge - config.warn) / span;
  const percent = Math.min(1, Math.max(0, normalized));
  const percentDisplay = Math.round(percent * 100);
  const depleted = normalized <= 0;
  const urgent = config.urgent != null && charge <= config.urgent;
  const barClass = depleted ? 'bg-red-500 animate-pulse' : urgent ? 'bg-amber-400' : 'bg-emerald-500';
  const capText = capacity ? `${charge}/${capacity}` : `${charge}`;
  return (
    <div className="space-y-1 rounded-sm bg-[#111] p-1 text-xs text-slate-200">
      <div className="flex items-center justify-between text-[0.65rem] text-slate-400">
        <span>{label}</span>
        <span>{status}</span>
      </div>
      <div className="flex items-center justify-between text-[0.7rem]">
        <span>Battery</span>
        <span>{capText} mAh</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-[width] ${barClass}`} style={{ width: `${percentDisplay}%` }} />
      </div>
    </div>
  );
}

function HudOverlay({ frame }) {
  const sensors = frame?.sensors;
  const bumps = sensors?.bumpsAndWheelDrops || {};
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(interval);
  }, []);

  const pulse = frame?.receivedAt ? now - frame.receivedAt < 200 : false;

  const bumperBadges = [
    { label: 'B-L', active: bumps.bumpLeft },
    { label: 'B-R', active: bumps.bumpRight },
  ];
  const wheelBadges = [
    { label: 'Drop L', active: bumps.wheelDropLeft },
    { label: 'Drop R', active: bumps.wheelDropRight },
  ];

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-1 text-[0.65rem] text-slate-200">
      <div className="flex items-center justify-between gap-1">
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
      </div>
    </div>
  );
}

function HudBadge({ label, active }) {
  return (
    <span
      className={`rounded-sm px-1 py-0.5 text-[0.55rem] ${active ? 'bg-emerald-500/30 text-emerald-100' : 'bg-black/40 text-slate-500'}`}
    >
      {label}
    </span>
  );
}

function OvercurrentOverlay({ active }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-red-900/60">
      <div className="text-center text-sm font-semibold text-red-100 animate-pulse">Overcurrent</div>
    </div>
  );
}
