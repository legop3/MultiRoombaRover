// PTZ Spectator Card
// Purpose: Adds the single room PTZ camera to the spectator rover grid.
// Scope: Uses live WHEP only when the server authorizes this socket; otherwise
// falls back to the PTZ snapshot feed that remote spectators are allowed to see.
import PtzLiveVideo from '../../../components/PtzLiveVideo/index.jsx';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { PTZ_CAMERA_ID, usePtzCameraSnapshots } from '../../../hooks/usePtzCameraSnapshot.js';

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

function formatPublisherProgress(progress = null) {
  /*
    Keep the spectator card dense, but expose enough ffmpeg progress to tell if
    the PTZ transcoder is running behind when the live feed looks delayed.
  */
  if (!progress) return null;
  return [
    progress.fps ? `fps ${progress.fps}` : null,
    progress.speed ? `speed ${progress.speed}` : null,
    progress.drop_frames ? `drop ${progress.drop_frames}` : null,
  ].filter(Boolean).join(' | ');
}

function PtzSnapshotFallback({ label, source }) {
  const snapshotFeeds = usePtzCameraSnapshots([PTZ_CAMERA_ID], { enabled: true });
  const snapshot = snapshotFeeds[PTZ_CAMERA_ID] || null;
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
      {snapshot?.objectUrl ? (
        <img src={snapshot.objectUrl} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
          {snapshot?.error || source?.error || 'Waiting for PTZ snapshot...'}
        </div>
      )}
      {/*
        Keep the PTZ snapshot fallback visually aligned with RoverMediaPlayer:
        the video surface owns only playback health, while the card around it
        owns identity/context. That prevents a second in-frame camera title and
        keeps fallback mode from looking different than live WHEP mode.
      */}
      <div className="pointer-events-none absolute left-1 top-1 z-20 font-medium text-slate-100 text-[0.65rem]">
        <div className="flex flex-col gap-0.5 leading-none">
          <span>Status: {snapshot?.status || 'snapshot'}</span>
        </div>
      </div>
    </div>
  );
}

function PtzLiveOrSnapshot({ label }) {
  const isExternalSpectatorSnapshotOnly = useSessionSelector((state) =>
    state.session?.role === 'spectator' &&
    state.session?.isLocalNetwork === false &&
    state.session?.bandwidthSavings?.externalSpectatorVideo === 'snapshots',
  );
  /*
    PTZ live authorization is server-owned, but the spectator page knows when
    the configured outcome is snapshot-only. Rendering the fallback directly
    avoids a guaranteed denied WHEP request for every external spectator card.
  */
  if (isExternalSpectatorSnapshotOnly) {
    return <PtzSnapshotFallback label={label} source={null} />;
  }
  return (
    <PtzLiveVideo
      enabled
      startMuted
      className="relative aspect-video w-full overflow-hidden rounded bg-black"
      fallback={({ source }) => <PtzSnapshotFallback label={label} source={source} />}
    />
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
  const publisherProgress = formatPublisherProgress(publisher.progress);
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
        {publisherProgress ? <InfoRow label="Progress" value={publisherProgress} /> : null}
        {publisher.lastStderr ? (
          <div className="line-clamp-2 break-words font-mono text-[0.65rem] leading-tight text-slate-400">
            {publisher.lastStderr}
          </div>
        ) : null}
      </div>
    </article>
  );
}
