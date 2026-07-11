// PTZ Spectator Card
// Purpose: Adds the single room PTZ camera to the spectator rover grid.
// Scope: Uses live WHEP only when the server authorizes this socket; otherwise
// falls back to the PTZ snapshot feed that remote spectators are allowed to see.
import { useEffect, useRef, useState } from 'react';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { usePtzCameraSnapshot } from '../../../hooks/usePtzCameraSnapshot.js';
import { useVideoRequests } from '../../../hooks/useVideoRequests.js';
import { WhepPlayer } from '../../../lib/whepPlayer.js';

const PTZ_CAMERA_ID = 'ptz-camera';

function formatRemaining(deadline) {
  const remaining = Math.max(0, Math.ceil((Number(deadline || 0) - Date.now()) / 1000));
  if (!remaining) return '--';
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function isSpotlightOn(light = {}) {
  if (typeof light?.on === 'boolean') return light.on;
  const raw = light?.state;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return !['', '0', 'off', 'false'].includes(normalized);
  }
  return Boolean(Number(raw));
}

function normalizeInfraredMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'on') return 'On';
  if (normalized === 'off') return 'Off';
  return 'Auto';
}

function InfoRow({ label, value, tone = '' }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-slate-400">{label}</span>
      <span className={`min-w-0 truncate ${tone || 'text-slate-100'}`}>{value}</span>
    </div>
  );
}

function PtzLiveOrSnapshot({ label }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [liveStatus, setLiveStatus] = useState('connecting');
  const sources = useVideoRequests(
    [{ type: 'ptz', id: PTZ_CAMERA_ID, key: PTZ_CAMERA_ID }],
    { enabled: true },
  );
  const source = sources[PTZ_CAMERA_ID] || null;
  const snapshot = usePtzCameraSnapshot({ enabled: Boolean(source?.error || !source?.url) });
  const useSnapshot = Boolean(source?.error || !source?.url);

  useEffect(() => {
    if (useSnapshot || !source?.url || !videoRef.current) return undefined;
    /*
      Spectator live access is decided by the server's video session policy.
      Local spectators get a WHEP URL, while remote spectators receive an error
      here and automatically fall back to the low-bandwidth snapshot feed.
    */
    const player = new WhepPlayer({
      url: source.url,
      token: source.token,
      video: videoRef.current,
      startMuted: true,
      onStatus: setLiveStatus,
    });
    playerRef.current = player;
    player.start().catch((err) => setLiveStatus(err.message || 'error'));
    return () => {
      player.stop();
      playerRef.current = null;
    };
  }, [source?.token, source?.url, useSnapshot]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
      {useSnapshot ? (
        snapshot?.objectUrl ? (
          <img src={snapshot.objectUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
            {snapshot?.error || source?.error || 'Waiting for PTZ snapshot...'}
          </div>
        )
      ) : (
        <video ref={videoRef} className="h-full w-full object-contain" playsInline autoPlay muted />
      )}
      <div className="pointer-events-none absolute left-0 top-0 bg-black/70 px-1 py-0.5 text-xs font-semibold text-white">
        {label}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 m-1 rounded bg-black/70 px-1 py-0.5 text-[0.7rem] text-slate-100">
        {useSnapshot ? snapshot?.status || 'snapshot' : liveStatus}
      </div>
    </div>
  );
}

export default function PtzSpectatorCard() {
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  if (!ptz?.enabled) return null;

  const publisher = ptz?.publisher || {};
  const publisherStatus = publisher.running
    ? 'running'
    : publisher.restartAt
      ? 'restarting'
      : publisher.lastEvent || 'stopped';
  const queueCount = Array.isArray(ptz?.queue) ? ptz.queue.length : 0;
  const label = ptz?.name || 'PTZ Camera';

  return (
    <article className="flex min-h-[16rem] flex-col rounded bg-zinc-900 p-0 sm:min-h-[18rem]">
      <PtzLiveOrSnapshot label={label} />
      <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden p-1 text-xs">
        <InfoRow label="Operator" value={ptz?.operatorLabel || 'none'} />
        <InfoRow label="Remaining" value={formatRemaining(ptz?.deadline)} />
        <InfoRow label="Queue" value={queueCount ? `${queueCount} waiting` : 'empty'} />
        <InfoRow label="Spotlight" value={isSpotlightOn(ptz?.light) ? 'On' : 'Off'} />
        <InfoRow label="Infrared" value={normalizeInfraredMode(ptz?.ir?.state)} />
        <InfoRow label="Transcoder" value={publisherStatus} tone={publisher.running ? 'text-emerald-300' : 'text-amber-300'} />
        {publisher.lastStderr ? (
          <div className="line-clamp-2 break-words font-mono text-[0.65rem] leading-tight text-slate-400">
            {publisher.lastStderr}
          </div>
        ) : null}
      </div>
    </article>
  );
}
