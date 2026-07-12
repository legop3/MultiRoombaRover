// PTZ Camera UI
// Purpose: Integrates the single PTZ camera into the main rover UI flow as a
// queueable controllable target instead of a VIP-panel card.
// Scope: Owns PTZ entry card and fullscreen composition; PTZ command authority,
// queue ownership, and stream authorization remain server-owned.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const { nudgeServo, stopAllMotion } = useControlActions();
  const repeatTimerRef = useRef(null);

  const stopZoom = useCallback(() => {
    /*
      Mobile zoom is intentionally routed through the normal camera-up/down
      control action instead of emitting PTZ socket commands directly. That
      keeps the zoom buttons on the same path as keyboard/gamepad camera tilt,
      and the PTZ adapter remains the one place that translates "camera nudge"
      into Reolink zoom pulses.
    */
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
    stopAllMotion();
  }, [stopAllMotion]);

  const startZoom = useCallback(
    (direction) => (event) => {
      /*
        Send an immediate nudge and then repeat while held. The adapter turns
        each nudge into a short zoom pulse, so repeating the standard action is
        the simplest way to get continuous hold-to-zoom without adding another
        PTZ-specific command loop.
      */
      event.preventDefault();
      if (disabled) return;
      stopZoom();
      nudgeServo(direction);
      repeatTimerRef.current = setInterval(() => {
        nudgeServo(direction);
      }, 120);
    },
    [disabled, nudgeServo, stopZoom],
  );
  const stopFromPointer = useCallback(
    (event) => {
      event?.preventDefault?.();
      if (disabled) return;
      stopZoom();
    },
    [disabled, stopZoom],
  );

  useEffect(
    () => () => {
      /*
        A touch surface can unmount during orientation changes or fullscreen
        close while a pointer is still down. Clear the repeat timer here so a
        held zoom button cannot keep firing camera-up/down actions after the
        mobile controls have disappeared.
      */
      if (repeatTimerRef.current) {
        clearInterval(repeatTimerRef.current);
        repeatTimerRef.current = null;
      }
    },
    [],
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

function PtzPresetPanel({ ptz }) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const {
    ptzListPresets,
    ptzGotoPreset,
    ptzCreatePreset,
    ptzRemovePreset,
  } = useSessionActions();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const presets = Array.isArray(ptz?.presets) ? ptz.presets : [];
  const isPresetAdmin = role === 'admin' || role === 'lockdown';
  const canMoveToPreset = Boolean(ptz?.isOperator);

  const refreshPresets = async () => {
    if (busy) return;
    setBusy('refresh');
    try {
      /*
        Presets live on the camera, not in browser state. A manual refresh gives
        admins a simple recovery path if another admin or the camera's native
        app changes preset storage while this UI is already open.
      */
      await ptzListPresets();
    } catch (err) {
      alert(err.message || 'Failed to refresh PTZ presets.');
    } finally {
      setBusy('');
    }
  };

  const goToPreset = async (preset) => {
    if (!canMoveToPreset || busy || !preset?.token) return;
    setBusy(`goto:${preset.token}`);
    try {
      /*
        Moving to a preset is a physical camera move, so the server still checks
        that this browser owns the active PTZ turn before accepting the command.
      */
      await ptzGotoPreset({ token: preset.token });
    } catch (err) {
      alert(err.message || 'Failed to move to PTZ preset.');
    } finally {
      setBusy('');
    }
  };

  const createPreset = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!isPresetAdmin || busy || !trimmed) return;
    setBusy('create');
    try {
      /*
        ONVIF setPreset stores the camera's current physical position. The UI
        only sends the admin's label; the server supplies the active profile
        token so browser code does not need to know camera profile internals.
      */
      await ptzCreatePreset({ name: trimmed });
      setName('');
    } catch (err) {
      alert(err.message || 'Failed to create PTZ preset.');
    } finally {
      setBusy('');
    }
  };

  const removePreset = async (preset) => {
    if (!isPresetAdmin || busy || !preset?.token) return;
    const confirmed = window.confirm(`Remove preset "${preset.name}"?`);
    if (!confirmed) return;
    setBusy(`remove:${preset.token}`);
    try {
      /*
        The token is the camera's durable preset identifier. Names are only UI
        labels and may not be unique, so deletion always targets the token.
      */
      await ptzRemovePreset({ token: preset.token });
    } catch (err) {
      alert(err.message || 'Failed to remove PTZ preset.');
    } finally {
      setBusy('');
    }
  };

  return (
    <CardFrame
      title="Position presets"
      fillHeight
      actions={(
        <button type="button" className="button-dark text-xs" disabled={Boolean(busy)} onClick={refreshPresets}>
          Refresh
        </button>
      )}
      bodyClassName="flex min-h-0 flex-col gap-1 p-1 text-xs"
    >
      {ptz?.presetsError ? (
        <div className="rounded border border-amber-500/50 bg-amber-950/40 p-1 text-amber-100">
          {ptz.presetsError}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {presets.length ? presets.map((preset) => {
          const gotoBusy = busy === `goto:${preset.token}`;
          const removeBusy = busy === `remove:${preset.token}`;
          return (
            <div key={preset.token} className="surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
              <button
                type="button"
                className="button-dark min-w-0 truncate text-left text-xs disabled:opacity-50"
                disabled={!canMoveToPreset || Boolean(busy)}
                onClick={() => goToPreset(preset)}
                title={canMoveToPreset ? `Move to ${preset.name}` : 'Your PTZ turn must be active'}
              >
                {gotoBusy ? 'Moving...' : preset.name}
              </button>
              {isPresetAdmin ? (
                <button
                  type="button"
                  className="button-dark text-xs text-rose-200 disabled:opacity-50"
                  disabled={Boolean(busy)}
                  onClick={() => removePreset(preset)}
                >
                  {removeBusy ? 'Removing...' : 'Remove'}
                </button>
              ) : null}
            </div>
          );
        }) : (
          <div className="rounded border border-slate-700 bg-black/30 p-2 text-center text-slate-400">
            No presets saved.
          </div>
        )}
      </div>
      {isPresetAdmin ? (
        <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-1" onSubmit={createPreset}>
          <input
            className="min-w-0 rounded border border-slate-700 bg-black px-2 py-1 text-xs text-slate-100 outline-none focus:border-cyan-300"
            value={name}
            maxLength={60}
            disabled={Boolean(busy)}
            onChange={(event) => setName(event.target.value)}
            placeholder="Preset name"
          />
          <button type="submit" className="button-dark text-xs" disabled={Boolean(busy) || !name.trim()}>
            {busy === 'create' ? 'Saving...' : 'Save'}
          </button>
        </form>
      ) : null}
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

function PtzMediaPane({ ptz, open, framed = true }) {
  const isOperator = Boolean(ptz?.isOperator);
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const snapshotFeeds = usePtzCameraSnapshots([PTZ_CAMERA_ID], { enabled: open && !isOperator });
  const snapshot = snapshotFeeds[PTZ_CAMERA_ID] || null;
  const turnModel = useMemo(() => buildPtzTurnModel(ptz, selfId), [ptz, selfId]);
  const media = (
    <>
      {isOperator ? (
        <PtzLiveVideo enabled={open} startMuted={false} label={ptz?.name || 'PTZ Camera'} />
      ) : (
        <PtzSnapshotPreview feed={snapshot} label={ptz?.name || 'PTZ Camera'} />
      )}
      <TurnsOverlay turnModel={turnModel} />
    </>
  );

  if (!framed) {
    return <div className="relative h-full min-h-0 w-full overflow-hidden bg-black">{media}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
      <div className="relative aspect-video max-h-full w-full max-w-full overflow-hidden bg-black">
        {media}
      </div>
    </div>
  );
}

function PtzDesktopFullscreen({ ptz, releasePending }) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(7rem,0.22fr)] gap-0.5 overflow-hidden p-0.5">
      <div className="flex min-h-0 min-w-0 gap-0.5 overflow-hidden">
        <main className="min-h-0 shrink-0 overflow-hidden bg-black" style={{ aspectRatio: '16 / 9' }}>
          <PtzMediaPane ptz={ptz} open framed />
        </main>
        <aside className="flex min-h-0 min-w-56 flex-1 flex-col gap-0.5 overflow-y-auto bg-neutral-950 text-sm">
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
        <PtzPresetPanel ptz={ptz} />
      </div>
      {releasePending ? (
        <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/80 px-2 py-1 text-xs text-slate-200">
          Closing...
        </div>
      ) : null}
    </div>
  );
}

function PtzMobileFullscreen({ ptz, layout, onClose, releasePending = false }) {
  const landscape = layout === 'mobile-landscape';
  const topHeightClass = landscape ? 'h-full min-h-[calc(100dvh-0.25rem)]' : 'h-[48dvh]';
  const topGridClass = landscape
    ? 'grid-cols-[minmax(0,1fr)_13rem]'
    : 'grid-cols-[minmax(0,1fr)_11rem]';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-0.5">
      <section className={`mobile-touch-control grid ${topHeightClass} min-h-48 shrink-0 ${topGridClass} gap-0.5`}>
        <main className="relative min-h-0 overflow-hidden bg-black">
          <button
            type="button"
            className="absolute left-1 top-1 z-50 rounded border border-white/40 bg-black/80 px-2 py-1 text-xs font-semibold text-white shadow disabled:opacity-50"
            disabled={releasePending}
            onClick={onClose}
          >
            Close
          </button>
          <PtzMediaPane ptz={ptz} open framed={false} />
        </main>
        <aside className="min-h-0 overflow-y-auto">
          <PtzMobileControlsPanel ptz={ptz} disabled={!ptz?.isOperator} />
        </aside>
      </section>
      <section className="grid gap-0.5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
        <ChatPanel title="Chat" allowSpectatorInput inputTarget="overlay" />
        <div className="space-y-0.5">
          <PtzQueueSummary ptz={ptz} />
          <PtzPresetPanel ptz={ptz} />
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
    /*
      The PTZ controller needs to cover the driver page, but it must not become
      the top-most application layer. Global fullscreen overlays like help,
      quickstart, mode gates, and connection warnings are still part of the
      active app state while PTZ is open, so this portal intentionally sits
      below their z-30+ overlay stack instead of hiding them.
    */
    <div className="fixed inset-0 z-20 h-[100dvh] w-[100vw] overflow-hidden bg-black text-slate-100">
      <CardFrame
        title={isMobile ? '' : ptz?.name || 'PTZ Camera'}
        actions={isMobile ? null : (
          <button type="button" className="button-dark text-xs" disabled={releasePending} onClick={releaseAndClose}>
            Close
          </button>
        )}
        hideHeader={isMobile}
        fillHeight
        clipOverflow={false}
        className="h-[100dvh] w-[100vw] rounded-none border-0 !bg-black"
        bodyClassName="relative min-h-0 flex-1"
      >
        {isMobile ? (
          <PtzMobileFullscreen
            ptz={ptz}
            layout={layout}
            onClose={releaseAndClose}
            releasePending={releasePending}
          />
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
              // description: ptz?.isOperator
              //   ? 'Live camera turn active'
              //   : ptz?.queuedPosition
              //   ? `Queue position ${ptz.queuedPosition}`
              //   : 'Pan, tilt, and zoom camera',
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
