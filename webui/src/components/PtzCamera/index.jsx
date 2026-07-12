// PTZ Camera UI
// Purpose: Integrates the single PTZ camera into the main rover UI flow as a
// queueable controllable target instead of a VIP-panel card.
// Scope: Owns PTZ entry card and fullscreen composition; PTZ command authority,
// queue ownership, and stream authorization remain server-owned.
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import CardFrame from '../CardFrame/index.jsx';
import ChatPanel from '../ChatPanel/index.jsx';
import ControlPadPanel from '../MobileControls/ControlPadPanel.jsx';
import GPIOToggleControl from '../GPIOToggleControl/index.jsx';
import PtzLiveVideo, { PTZ_CAMERA_ID } from '../PtzLiveVideo/index.jsx';
import ReplaySourcesPanel from '../ReplaySourcesPanel/index.jsx';
import QueueTargetRow, { QueueUserChips } from '../QueueTargetRow/index.jsx';
import TurnsOverlay from '../HudOverlays/TurnsOverlay/index.jsx';
import KeyPill from '../vip/VipAudioUploadCard/KeyPill.jsx';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { usePtzCameraSnapshots } from '../../hooks/usePtzCameraSnapshot.js';
import { useSharedClock } from '../../hooks/useSharedClock.js';
import { isFeatureEnabled } from '../../lib/features.js';
import { trackAnalyticsEvent } from '../../analytics/index.js';

const PTZ_ZOOM_SPEED = 0.55;
const PTZ_DEFAULT_COLOR = '#38bdf8';

function formatRemaining(deadline, now) {
  const remaining = Math.max(0, Math.ceil((Number(deadline || 0) - now) / 1000));
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

function normalizeIrMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'on') return 'On';
  if (normalized === 'off') return 'Off';
  return 'Auto';
}

function nextIrMode(currentMode) {
  const current = normalizeIrMode(currentMode);
  if (current === 'Auto') return 'On';
  if (current === 'On') return 'Off';
  return 'Auto';
}

function normalizePtzQueue(ptz = null) {
  /*
    The PTZ service exposes the current operator separately from the waiting
    queue, while the rover queue row expects one ordered queue plus a current id.
    Normalizing once keeps every PTZ surface consistent with the shared queue
    renderer without making that renderer understand PTZ service internals.
  */
  const currentId = ptz?.operatorSocketId || null;
  const waiting = Array.isArray(ptz?.queue)
    ? ptz.queue.map((entry) => entry?.socketId || entry).filter(Boolean)
    : [];
  const queue = currentId ? [currentId, ...waiting.filter((id) => id !== currentId)] : waiting;
  const nextId = currentId ? waiting[0] || null : queue[0] || null;
  return { queue, currentId, nextId };
}

function usePtzQueueLookup(ptz = null) {
  const users = useSessionSelector((state) => state.session?.users ?? []);
  return useCallback(
    (socketId) => {
      const fromUsers = users.find((entry) => entry.socketId === socketId);
      if (fromUsers) return fromUsers;
      if (ptz?.operatorSocketId === socketId) {
        return { socketId, nickname: ptz?.operatorLabel || null, role: null };
      }
      const fromQueue = Array.isArray(ptz?.queue)
        ? ptz.queue.find((entry) => (entry?.socketId || entry) === socketId)
        : null;
      return {
        socketId,
        nickname: fromQueue?.label || null,
        role: null,
      };
    },
    [ptz, users],
  );
}

function PtzSnapshotPreview({ feed, label = 'PTZ Camera', className = 'h-full w-full' }) {
  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      {feed?.objectUrl ? (
        <img src={feed.objectUrl} alt={label} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">Waiting for snapshot...</div>
      )}
      <div className="pointer-events-none absolute left-0 top-0 bg-black/70 px-1 py-0.5 text-xs font-semibold text-white">
        {label}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-slate-100">
        {feed?.error ? `Error: ${feed.error}` : feed?.status || 'connecting'}
      </div>
    </div>
  );
}

function StatusRow({ label, value, tone = '' }) {
  return (
    <div className="flex items-center justify-between gap-1 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={`min-w-0 truncate font-medium ${tone || 'text-slate-100'}`}>{value}</span>
    </div>
  );
}

function PtzStatePanel({ ptz, compact = false }) {
  const now = useSharedClock(1000, Boolean(ptz?.deadline));
  const spotlightOn = isSpotlightOn(ptz?.light);
  const irMode = normalizeIrMode(ptz?.ir?.state);
  const publisher = ptz?.publisher || {};
  const publisherStatus = publisher.running
    ? 'running'
    : publisher.restartAt
    ? 'restarting'
    : publisher.lastEvent || 'stopped';
  const mode = ptz?.isOperator ? 'operator' : ptz?.queuedPosition ? `queued ${ptz.queuedPosition}` : 'spectator';

  return (
    <CardFrame title="Camera state" bodyClassName="space-y-0.5 p-1 text-sm">
      <StatusRow label="Mode" value={mode} tone={ptz?.isOperator ? 'text-emerald-300' : ''} />
      <StatusRow label="Operator" value={ptz?.operatorLabel || 'none'} />
      <StatusRow label="Remaining" value={formatRemaining(ptz?.deadline, now)} />
      <StatusRow label="Spotlight" value={spotlightOn ? 'On' : 'Off'} tone={spotlightOn ? 'text-emerald-300' : 'text-slate-200'} />
      <StatusRow label="Infrared mode" value={irMode} />
      <StatusRow label="Stream" value={ptz?.status || ptz?.error || 'idle'} tone={ptz?.error ? 'text-amber-300' : ''} />
      {!compact ? <StatusRow label="Transcoder" value={publisherStatus} tone={publisher.running ? 'text-emerald-300' : 'text-amber-300'} /> : null}
      {ptz?.blocked?.message ? (
        <div className="rounded border border-amber-500/50 bg-amber-950/40 p-1 text-xs text-amber-100">
          {ptz.blocked.message}
        </div>
      ) : null}
    </CardFrame>
  );
}

function PtzQueueSummary({ ptz, title = 'PTZ queue' }) {
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const lookupUser = usePtzQueueLookup(ptz);
  const { queue, currentId, nextId } = normalizePtzQueue(ptz);

  return (
    <CardFrame title={title} bodyClassName="space-y-0.5 p-1 text-sm">
      <QueueUserChips
        targetId={ptz?.id || PTZ_CAMERA_ID}
        queue={queue}
        currentId={currentId}
        nextId={nextId}
        selfId={selfId}
        lookupUser={lookupUser}
      />
    </CardFrame>
  );
}

function PtzLightingControls({ ptz, disabled = false }) {
  const { ptzSpotlight, ptzIr } = useSessionActions();
  const [busy, setBusy] = useState('');
  const spotlightOn = isSpotlightOn(ptz?.light);
  const irMode = normalizeIrMode(ptz?.ir?.state);

  const toggleSpotlight = async (nextOn) => {
    if (disabled) return;
    setBusy('spotlight');
    try {
      await ptzSpotlight({ state: nextOn ? 1 : 0 });
    } finally {
      setBusy('');
    }
  };

  const cycleIr = async () => {
    if (disabled) return;
    setBusy('ir');
    try {
      await ptzIr({ state: nextIrMode(irMode) });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mobile-touch-control grid grid-cols-2 gap-0.5 text-sm">
      <GPIOToggleControl
        label="Spotlight"
        on={spotlightOn}
        disabled={disabled || busy === 'spotlight'}
        onToggle={toggleSpotlight}
        heightClass="min-h-14"
      />
      <button
        type="button"
        className="mobile-touch-control flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-cyan-300/70 bg-cyan-900 px-1 py-0.75 text-center text-cyan-50 disabled:opacity-50"
        disabled={disabled || busy === 'ir'}
        onClick={cycleIr}
      >
        <span className="text-sm font-semibold">Infrared</span>
        <span className="rounded bg-cyan-300 px-1 py-0.5 text-[0.7rem] font-semibold text-cyan-950">{irMode}</span>
      </button>
    </div>
  );
}

function PtzMobileZoomButtons({ disabled = false }) {
  const { ptzMove, ptzStop } = useSessionActions();
  const stopZoom = useCallback(() => {
    ptzStop().catch(() => {});
  }, [ptzStop]);
  const startZoom = useCallback(
    (direction) => (event) => {
      /*
        The rover mobile movement pad is reused for PTZ pan/tilt through the
        control adapter, so zoom needs its own two hold buttons on mobile.
      */
      event.preventDefault();
      if (disabled) return;
      ptzMove({ pan: 0, tilt: 0, zoom: direction * PTZ_ZOOM_SPEED }).catch(() => {});
    },
    [disabled, ptzMove],
  );
  const stopFromPointer = useCallback(
    (event) => {
      event?.preventDefault?.();
      if (disabled) return;
      stopZoom();
    },
    [disabled, stopZoom],
  );

  return (
    <div className="mobile-touch-control grid grid-cols-2 gap-0.5 text-sm">
      <button
        type="button"
        className="mobile-touch-control button-dark min-h-10 text-xs disabled:opacity-50"
        disabled={disabled}
        onPointerDown={startZoom(-1)}
        onPointerUp={stopFromPointer}
        onPointerCancel={stopFromPointer}
        onPointerLeave={stopFromPointer}
        onContextMenu={(event) => event.preventDefault()}
      >
        Zoom out
      </button>
      <button
        type="button"
        className="mobile-touch-control button-dark min-h-10 text-xs disabled:opacity-50"
        disabled={disabled}
        onPointerDown={startZoom(1)}
        onPointerUp={stopFromPointer}
        onPointerCancel={stopFromPointer}
        onPointerLeave={stopFromPointer}
        onContextMenu={(event) => event.preventDefault()}
      >
        Zoom in
      </button>
    </div>
  );
}

function PtzMobileControlsPanel({ ptz, disabled = false }) {
  return (
    <div className="mobile-touch-control space-y-0.5">
      <PtzMobileZoomButtons disabled={disabled} />
      <div className="mobile-touch-control h-44 min-h-0">
        {/*
          Reuse the rover control pad so touch intent still enters the normal
          control system. The PTZ adapter translates that same drive vector into
          pan/tilt commands only while this user is the PTZ operator.
        */}
        <ControlPadPanel compact disabled={disabled} />
      </div>
      <PtzLightingControls ptz={ptz} disabled={disabled} />
    </div>
  );
}

function keyLabelFor(keymap, actionId) {
  return formatKeyLabel(keymap?.[actionId]?.[0]);
}

function PtzControlReference() {
  const keymap = useControlSelector((control) => control.state.keymap);
  const rows = [
    ['Tilt up', 'driveForward'],
    ['Tilt down', 'driveBackward'],
    ['Pan left', 'driveLeft'],
    ['Pan right', 'driveRight'],
    ['Zoom in', 'cameraUp'],
    ['Zoom out', 'cameraDown'],
    ['Spotlight', 'headlightToggle'],
    ['Infrared mode', 'laserToggle'],
  ];

  return (
    <CardFrame title="Controls" bodyClassName="space-y-0.5 p-1 text-xs">
      {rows.map(([label, actionId]) => (
        <div key={label} className="surface flex items-center justify-between gap-1">
          <span className="text-slate-400">{label}</span>
          <KeyPill label={keyLabelFor(keymap, actionId)} />
        </div>
      ))}
    </CardFrame>
  );
}

function buildPtzTurnModel(ptz, selfId) {
  const { queue, currentId, nextId } = normalizePtzQueue(ptz);
  const isActive = Boolean(ptz?.isOperator);
  const isQueued = Boolean(ptz?.queuedPosition);
  return {
    enabled: Boolean(ptz && (isActive || isQueued || currentId)),
    targetId: ptz?.id || PTZ_CAMERA_ID,
    activeId: currentId,
    nextId,
    isActive,
    isNext: Boolean(selfId && nextId === selfId),
    deadline: ptz?.deadline || null,
    idleDeadline: null,
    showNotTurnNotice: Boolean(!isActive && (isQueued || currentId || queue.length)),
    showPreviewReason: false,
  };
}

function PtzMediaPane({ ptz, open }) {
  const isOperator = Boolean(ptz?.isOperator);
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const snapshotFeeds = usePtzCameraSnapshots([PTZ_CAMERA_ID], { enabled: open && !isOperator });
  const snapshot = snapshotFeeds[PTZ_CAMERA_ID] || null;
  const turnModel = useMemo(() => buildPtzTurnModel(ptz, selfId), [ptz, selfId]);

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
      <div className="relative aspect-video max-h-full w-full max-w-full overflow-hidden bg-black">
        {isOperator ? (
          <PtzLiveVideo enabled={open} startMuted={false} label={ptz?.name || 'PTZ Camera'} />
        ) : (
          <PtzSnapshotPreview feed={snapshot} label={ptz?.name || 'PTZ Camera'} />
        )}
        <TurnsOverlay turnModel={turnModel} />
      </div>
    </div>
  );
}

function PtzDesktopFullscreen({ ptz, releasePending }) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(9rem,0.32fr)] gap-0.5 overflow-hidden p-0.5">
      <div className="flex min-h-0 min-w-0 gap-0.5 overflow-hidden">
        <main className="min-h-0 shrink-0 overflow-hidden bg-black" style={{ aspectRatio: '16 / 9' }}>
          <PtzMediaPane ptz={ptz} open />
        </main>
        <aside className="flex min-h-0 min-w-80 flex-1 flex-col gap-0.5 overflow-y-auto bg-neutral-950 text-sm">
          <PtzQueueSummary ptz={ptz} />
          {ptz?.isOperator ? (
            <PtzLightingControls ptz={ptz} />
          ) : (
            <CardFrame title="Controls" bodyClassName="p-1 text-xs text-slate-400">
              Live PTZ controls unlock when your camera turn is active.
            </CardFrame>
          )}
          <PtzControlReference />
          <PtzStatePanel ptz={ptz} />
          <ReplaySourcesPanel panelId="ptz-controller-replay" />
        </aside>
      </div>
      <div className="grid min-h-0 grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.7fr)] gap-0.5 overflow-hidden">
        <ChatPanel fillHeight title="Chat" allowSpectatorInput inputTarget="overlay" />
        <CardFrame title="Position presets" fillHeight bodyClassName="p-1 text-xs text-slate-500">
          Presets will live here.
        </CardFrame>
      </div>
      {releasePending ? (
        <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/80 px-2 py-1 text-xs text-slate-200">
          Closing...
        </div>
      ) : null}
    </div>
  );
}

function PtzMobileFullscreen({ ptz, layout }) {
  const landscape = layout === 'mobile-landscape';
  const videoClass = landscape ? 'h-[62svh]' : 'h-[42svh]';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-0.5">
      <main className={`${videoClass} min-h-0 overflow-hidden bg-black`}>
        <PtzMediaPane ptz={ptz} open />
      </main>
      <section className="mobile-touch-control">
        <PtzMobileControlsPanel ptz={ptz} disabled={!ptz?.isOperator} />
      </section>
      <section className="grid gap-0.5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
        <ChatPanel title="Chat" allowSpectatorInput inputTarget="overlay" />
        <div className="space-y-0.5">
          <PtzQueueSummary ptz={ptz} />
          <PtzStatePanel ptz={ptz} compact />
          <ReplaySourcesPanel panelId="ptz-controller-replay-mobile" />
        </div>
      </section>
    </div>
  );
}

export function PtzFullscreenController({ open, onClose, layout = 'desktop' }) {
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const { ptzRelease } = useSessionActions();
  const { stopAllMotion } = useControlActions();
  const [releasePending, setReleasePending] = useState(false);
  const isMobile = layout === 'mobile-portrait' || layout === 'mobile-landscape';

  const releaseAndClose = useCallback(async () => {
    if (releasePending) return;
    setReleasePending(true);
    try {
      /*
        Stop first so a held key/pointer cannot leave ONVIF continuous movement
        running while the server removes this socket from the PTZ queue.
      */
      stopAllMotion?.();
      await ptzRelease();
      onClose?.();
    } finally {
      setReleasePending(false);
    }
  }, [onClose, ptzRelease, releasePending, stopAllMotion]);

  if (!open) return null;

  const controller = (
    <div className="fixed inset-0 z-[110] h-[100dvh] w-[100vw] overflow-hidden bg-black text-slate-100">
      <CardFrame
        title={ptz?.name || 'PTZ Camera'}
        actions={(
          <button type="button" className="button-dark text-xs" disabled={releasePending} onClick={releaseAndClose}>
            Close
          </button>
        )}
        fillHeight
        clipOverflow={false}
        className="h-[100dvh] w-[100vw] rounded-none border-0 !bg-black"
        bodyClassName="relative min-h-0 flex-1"
      >
        {isMobile ? (
          <PtzMobileFullscreen ptz={ptz} layout={layout} />
        ) : (
          <PtzDesktopFullscreen ptz={ptz} releasePending={releasePending} />
        )}
      </CardFrame>
    </div>
  );

  return createPortal(controller, document.body);
}

export default function PtzQueueCard({ layout = 'desktop' }) {
  const featureEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'ptzCamera'));
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const role = useSessionSelector((state) => state.session?.role || null);
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const { ptzClaim, ptzRelease } = useSessionActions();
  const lookupUser = usePtzQueueLookup(ptz);
  const { queue, currentId, nextId } = normalizePtzQueue(ptz);
  const now = useSharedClock(1000, Boolean(ptz?.deadline));
  const [controllerOpen, setControllerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const canUse = Boolean(ptz?.canUse || isVerified || role === 'admin' || role === 'lockdown');
  const isParticipant = Boolean(ptz?.isOperator || ptz?.queuedPosition);
  const timerLabel = ptz?.isOperator && ptz?.deadline ? `${formatRemaining(ptz.deadline, now)} left` : '';

  if (!featureEnabled) return null;

  const handleRequest = async () => {
    if (!canUse || pending) return;
    if (isParticipant) {
      setControllerOpen(true);
      return;
    }
    setPending(true);
    trackAnalyticsEvent('ptz_queue_join', { layout });
    try {
      const response = await ptzClaim();
      /*
        The server is authoritative for whether the click became an active turn
        or a queued wait. Open only after it confirms one of those states so a
        dock-guard rejection does not strand the user in fullscreen.
      */
      if (response?.state?.isOperator || response?.state?.queuedPosition) {
        setControllerOpen(true);
      }
      trackAnalyticsEvent('ptz_queue_join_result', { layout, status: 'accepted' });
    } catch (err) {
      trackAnalyticsEvent('ptz_queue_join_result', {
        layout,
        status: 'failed',
        reason: err?.message || 'unknown',
      });
      alert(err.message || 'PTZ request failed.');
    } finally {
      setPending(false);
    }
  };

  const handleLeave = async () => {
    if (pending) return;
    setPending(true);
    try {
      await ptzRelease();
    } catch (err) {
      alert(err.message || 'Failed to leave PTZ camera.');
    } finally {
      setPending(false);
    }
  };

  const actionLabel = pending
    ? '...'
    : ptz?.isOperator
    ? 'Open'
    : ptz?.queuedPosition
    ? 'Open'
    : 'request';

  return (
    <>
      <CardFrame title={ptz?.name || 'PTZ camera'} bodyClassName="relative space-y-0.5 text-sm">
        <ul className="space-y-0.5 text-sm">
          <QueueTargetRow
            target={{
              id: ptz?.id || PTZ_CAMERA_ID,
              name: ptz?.name || 'PTZ Camera',
              color: ptz?.color || PTZ_DEFAULT_COLOR,
              description: ptz?.isOperator
                ? 'Live camera turn active'
                : ptz?.queuedPosition
                ? `Queue position ${ptz.queuedPosition}`
                : 'Pan, tilt, and zoom camera',
            }}
            queue={queue}
            currentId={currentId}
            nextId={nextId}
            selfId={selfId}
            lookupUser={lookupUser}
            canClick={canUse && !pending}
            pending={pending}
            buttonLabel={actionLabel}
            batteryLabel={ptz?.isOperator ? 'LIVE' : ptz?.queuedPosition ? `#${ptz.queuedPosition}` : '--'}
            batteryClassName={ptz?.isOperator ? 'text-emerald-300' : ptz?.queuedPosition ? 'text-sky-300' : 'text-slate-400'}
            timerLabel={timerLabel}
            onRequest={handleRequest}
            showAction={canUse}
          />
        </ul>
        {isParticipant ? (
          <button type="button" className="button-dark w-full text-xs" disabled={pending} onClick={handleLeave}>
            Leave PTZ queue
          </button>
        ) : null}
        {!canUse ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded bg-black/75 px-2 text-center text-sm font-semibold text-slate-100">
            Verify your account to use the PTZ camera.
          </div>
        ) : null}
      </CardFrame>
      <PtzFullscreenController open={controllerOpen} onClose={() => setControllerOpen(false)} layout={layout} />
    </>
  );
}
