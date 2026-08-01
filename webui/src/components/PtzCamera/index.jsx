// PTZ Camera UI
// Purpose: Integrates the single PTZ camera into the main rover UI flow as a
// queueable controllable target instead of a VIP-panel card.
// Scope: Owns the driver-page PTZ entry card and the dedicated PTZ route
// composition; PTZ command authority, queue ownership, and stream authorization
// remain server-owned.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CardFrame from '../CardFrame/index.jsx';
import ChatPanel from '../ChatPanel/index.jsx';
import ControlPadPanel from '../MobileControls/ControlPadPanel.jsx';
import GPIOToggleControl from '../GPIOToggleControl/index.jsx';
import HomeAssistantControls from '../HomeAssistantControls/index.jsx';
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
import { useSettingsNamespace } from '../../settings/index.js';
import { DEFAULT_PAGE_THEME_KEY, getPageThemeClass } from '../../themes/index.js';
import { triggerTouchHaptic } from '../../lib/touchHaptics.js';

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
      {/*
        Snapshot mode should look like the regular rover video player: the
        camera name belongs to the surrounding card/menu, while the media pane
        only exposes stream health in the small top-left diagnostic overlay.
      */}
      <div className="pointer-events-none absolute left-1 top-1 z-20 font-medium text-slate-100 text-[0.65rem]">
        <div className="flex flex-col gap-0.5 leading-none">
          <span>Status: {feed?.error ? `Error: ${feed.error}` : feed?.status || 'connecting'}</span>
        </div>
      </div>
    </div>
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
    triggerTouchHaptic('button');
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
  const { setCameraAxisIntent } = useControlActions();

  const stopZoom = useCallback(() => {
    /*
      Zero only releases the zoom axis. The PTZ adapter combines it with any
      pan/tilt direction still held on the movement pad, so lifting one finger
      cannot erase the other finger's intent.
    */
    setCameraAxisIntent(0);
  }, [setCameraAxisIntent]);

  const startZoom = useCallback(
    (direction) => (event) => {
      /*
        Publish held state once. The adapter owns the single motion heartbeat,
        so this button no longer creates a second interval whose queued callback
        could run after pointerup and restart zoom.
      */
      event.preventDefault();
      if (disabled) return;
      triggerTouchHaptic('button');
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setCameraAxisIntent(direction);
    },
    [disabled, setCameraAxisIntent],
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
        close while a pointer is still down. Explicitly clear zoom here because
        an unmounted DOM node cannot deliver its pointerup/pointercancel event.
      */
      setCameraAxisIntent(0);
    },
    [setCameraAxisIntent],
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
        onLostPointerCapture={stopFromPointer}
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
        onLostPointerCapture={stopFromPointer}
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
  const canCreatePreset = Boolean(ptz?.canUse);
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
    if (!canCreatePreset || busy || !trimmed) return;
    setBusy('create');
    try {
      /*
        ONVIF setPreset stores the camera's current physical position. The UI
        only sends the user's label; the server supplies the active profile
        token so browser code does not need camera profile internals, and the
        server still enforces the PTZ feature gate for raw socket callers.
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
      <div className="flex min-h-0 flex-1 flex-wrap content-start items-start gap-0.5 overflow-y-auto">
        {/*
          Presets should behave like a compact pile of actions, not a table.
          flex-wrap lets each preset keep its natural button width and only
          starts a new visual line when the current line runs out of room.
        */}
        {presets.length ? presets.map((preset) => {
          const gotoBusy = busy === `goto:${preset.token}`;
          const removeBusy = busy === `remove:${preset.token}`;
          return (
            <div key={preset.token} className="surface inline-flex max-w-full items-center gap-1">
              <button
                type="button"
                className="button-dark min-w-0 max-w-40 truncate text-left text-xs disabled:opacity-50"
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
      {canCreatePreset ? (
        <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-1" onSubmit={createPreset}>
          <input
            className="field-input min-w-0 text-xs"
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
  const isParticipant = Boolean(isOperator || ptz?.queuedPosition);
  const nonTurnSnapshotsActive = useSessionSelector(
    (state) => Boolean(state.session?.bandwidthSavings?.nonTurnVideo?.snapshotsActive),
  );
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  /*
    PTZ has its own turn queue, so non-operators are the camera equivalent of a
    non-active rover driver. The server enforces the same policy in
    canRequestLiveVideo(); this branch only chooses the expected browser render
    path and never unlocks movement controls.
  */
  /*
    A direct /ptz load renders before its automatic queue claim is acknowledged.
    Do not mount the live player during that short pre-claim window: its first
    token request would correctly be rejected, and PtzLiveVideo intentionally
    treats authorization rejection as a terminal snapshot fallback. Once the
    session confirms queue/operator membership, mounting the player creates a
    fresh authorized request without changing shared retry or server policy.
  */
  const shouldUseLiveVideo = isParticipant && (isOperator || !nonTurnSnapshotsActive);
  const snapshotFeeds = usePtzCameraSnapshots([PTZ_CAMERA_ID], { enabled: open && !shouldUseLiveVideo });
  const snapshot = snapshotFeeds[PTZ_CAMERA_ID] || null;
  const turnModel = useMemo(() => buildPtzTurnModel(ptz, selfId), [ptz, selfId]);
  const media = (
    <>
      {shouldUseLiveVideo ? (
        <PtzLiveVideo enabled={open} startMuted={false} />
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
        {/* Keep the sidebar itself transparent. Its child cards still own their dark surfaces,
            while the shared PTZ page theme can show through the same compact gaps as the driver
            layout instead of being covered by one solid sidebar rectangle. */}
        <aside className="flex min-h-0 min-w-56 flex-1 flex-col gap-0.5 overflow-y-auto text-sm">
          <PtzQueueSummary ptz={ptz} />
          {ptz?.isOperator ? (
            <PtzLightingControls ptz={ptz} />
          ) : (
            <CardFrame title="Controls" bodyClassName="p-1 text-xs text-slate-400">
              Live PTZ controls unlock when your camera turn is active.
            </CardFrame>
          )}
          <PtzControlReference />
          <ReplaySourcesPanel panelId="ptz-controller-replay" defaultSelectedKey={`ptz:${PTZ_CAMERA_ID}`} />
          {/*
            Desktop keeps room controls as the final sidebar tool so camera
            turn controls and replay remain above the less-frequent room-wide
            actions. HomeAssistantControls owns its own feature and policy gate.
          */}
          <HomeAssistantControls />
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

function PtzMobileLandscape({ ptz, onClose, releasePending = false }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-0.5">
      {/*
        Landscape intentionally retains one control column beside the video.
        This is the established PTZ interaction and avoids forcing rover-style
        left/right columns onto a camera that has a smaller control inventory.
      */}
      <section className="mobile-touch-control grid min-h-[calc(100dvh-0.25rem)] shrink-0 grid-cols-[minmax(0,1fr)_13rem] items-start gap-0.5">
        {/*
          The video keeps one viewport of height, but the grid row is allowed to
          grow when the control column is taller. That makes the sidebar's tail
          extend below the video instead of forcing it into a nested scroller.
        */}
        <div className="min-w-0 space-y-0.5">
          <main className="relative h-[calc(100dvh-0.25rem)] min-h-0 overflow-hidden bg-black">
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
          {/*
            The right control column is naturally taller than the viewport.
            Placing room controls after the fixed-height video uses that left-
            column space while the whole landscape page continues scrolling as
            one surface.
          */}
          <HomeAssistantControls />
        </div>
        {/*
          Do not put overflow scrolling on this column. The surrounding PTZ
          landscape content is the single page scroller, so a swipe over either
          the video area or these controls advances the same document flow.
        */}
        <aside className="min-h-0 space-y-0.5">
          {/*
            Landscape keeps all turn-critical controls in its one existing
            sidebar. Queue position belongs first so the operator can confirm
            control ownership before touching the camera, while replay follows
            the lighting buttons because it is the next secondary action in
            the same scroll column.
          */}
          <PtzQueueSummary ptz={ptz} />
          <PtzMobileControlsPanel ptz={ptz} disabled={!ptz?.isOperator} />
          <ReplaySourcesPanel
            panelId="ptz-controller-replay-mobile-landscape"
            defaultSelectedKey={`ptz:${PTZ_CAMERA_ID}`}
          />
        </aside>
      </section>
      <section className="grid gap-0.5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
        <ChatPanel title="Chat" allowSpectatorInput inputTarget="overlay" />
        <PtzPresetPanel ptz={ptz} />
      </section>
    </div>
  );
}

function PtzMobilePortrait({ ptz, onClose, releasePending = false }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-0.5">
      <main className="relative aspect-video min-h-0 shrink-0 overflow-hidden bg-black">
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
      {/*
        Portrait gives the video its full available width and places controls
        below it. Reusing the landscape sidebar width here was the source of the
        cramped portrait presentation, while the controls themselves remain the
        same shared PTZ controls used in landscape.
      */}
      <section className="mobile-touch-control">
        <PtzMobileControlsPanel ptz={ptz} disabled={!ptz?.isOperator} />
      </section>
      <section className="space-y-0.5">
        {/*
          Replay and presets are compact secondary actions, so portrait places
          them in one equal-width row before the full-width queue and chat. The
          explicit two-column grid keeps this arrangement local to portrait and
          leaves the desktop and one-column landscape compositions unchanged.
        */}
        <div className="grid grid-cols-2 items-start gap-0.5">
          <ReplaySourcesPanel
            panelId="ptz-controller-replay-mobile-portrait"
            defaultSelectedKey={`ptz:${PTZ_CAMERA_ID}`}
          />
          <PtzPresetPanel ptz={ptz} />
        </div>
        <PtzQueueSummary ptz={ptz} />
        <ChatPanel title="Chat" allowSpectatorInput inputTarget="overlay" />
        {/* Portrait keeps room controls immediately after chat as requested. */}
        <HomeAssistantControls />
      </section>
    </div>
  );
}

export function PtzControllerPage({ layout = 'desktop' }) {
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const featureEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'ptzCamera'));
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const role = useSessionSelector((state) => state.session?.role || null);
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const { ptzClaim, ptzRelease, pushAlert } = useSessionActions();
  const { stopAllMotion } = useControlActions();
  const navigate = useNavigate();
  const [releasePending, setReleasePending] = useState(false);
  const autoClaimSocketRef = useRef(null);
  const routeExitReleaseTimerRef = useRef(null);
  const participantRef = useRef(false);
  const closingThroughButtonRef = useRef(false);
  const { value: pageSettings } = useSettingsNamespace('page', {
    backgroundTheme: DEFAULT_PAGE_THEME_KEY,
  });
  const isMobile = layout !== 'desktop';
  const canUse = Boolean(ptz?.canUse || isVerified || role === 'admin' || role === 'lockdown');
  const isParticipant = Boolean(ptz?.isOperator || ptz?.queuedPosition);
  // PTZ is a separate route but shares the browser's page settings. Applying the catalog class to
  // its body surface exposes the theme only through layout padding and card gaps; camera pixels,
  // controls, and card interiors retain their purpose-built dark backgrounds.
  const pageBackgroundClass = getPageThemeClass(pageSettings?.backgroundTheme);

  useEffect(() => {
    // Route-exit cleanup runs after the last render, so retain the latest
    // server-confirmed membership without making the lifecycle effect resubscribe.
    participantRef.current = isParticipant;
  }, [isParticipant]);

  useEffect(() => {
    if (routeExitReleaseTimerRef.current) {
      clearTimeout(routeExitReleaseTimerRef.current);
      routeExitReleaseTimerRef.current = null;
    }

    return () => {
      if (!participantRef.current || closingThroughButtonRef.current) return;
      /*
        Browser Back and route navigation unmount the PTZ page without invoking
        its Close button. Defer release by one task so React Strict Mode's
        development-only cleanup/remount cycle can cancel it in the next setup;
        a real route exit has no replacement setup, so membership is released.

        This is intentionally membership-gated. An admin release command can
        revoke the current operator even when the admin is not that operator,
        so an admin merely visiting/leaving a disabled or unjoined page must not
        emit a release command.
      */
      routeExitReleaseTimerRef.current = setTimeout(() => {
        routeExitReleaseTimerRef.current = null;
        ptzRelease().catch(() => {});
      }, 0);
    };
  }, [ptzRelease]);

  useEffect(() => {
    if (!featureEnabled || !ptz || !socketId || !canUse) return undefined;

    if (ptz.isOperator || ptz.queuedPosition) {
      /*
        Navigation from the driver queue normally arrives with membership
        already established. Mark this socket complete so later session syncs
        cannot turn that normal route transition into another claim request.
      */
      autoClaimSocketRef.current = socketId;
      return undefined;
    }

    if (autoClaimSocketRef.current === socketId) return undefined;
    autoClaimSocketRef.current = socketId;
    let active = true;

    /*
      A direct /ptz load still receives the ordinary user role first, which can
      briefly assign a rover. Claiming through the existing server action is
      deliberate: ptzCameraService releases that rover ownership before it
      activates or queues this socket, keeping one authoritative transition.

      The socket-keyed ref suppresses repeats caused by session updates and
      React's development effect replay. The server claim is also idempotent for
      an existing operator/queue member, which covers an acknowledgement racing
      with a fresh public-state sync.
    */
    ptzClaim().catch((err) => {
      if (!active) return;
      pushAlert({
        id: `ptz-auto-claim-${socketId}`,
        title: 'PTZ camera',
        message: err?.message || 'Unable to join the PTZ queue.',
        color: '#f59e0b',
        lifetimeMs: 6000,
      });
    });

    return () => {
      // Do not emit or update UI from a rejected request after this route has
      // unmounted; the server still owns completion of any request in flight.
      active = false;
    };
  }, [canUse, featureEnabled, ptz, ptzClaim, pushAlert, socketId]);

  const releaseAndClose = useCallback(async () => {
    if (releasePending) return;
    setReleasePending(true);
    closingThroughButtonRef.current = true;
    try {
      /*
        Stop first so a held key/pointer cannot leave ONVIF continuous movement
        running while the server removes this socket from the PTZ queue.
      */
      stopAllMotion?.();
      if (ptz?.isOperator || ptz?.queuedPosition) {
        await ptzRelease();
      }
      navigate('/');
    } catch (err) {
      // A rejected manual release leaves the route mounted, so route-exit
      // cleanup must remain armed for a later Back/navigation attempt.
      closingThroughButtonRef.current = false;
      throw err;
    } finally {
      setReleasePending(false);
    }
  }, [navigate, ptz?.isOperator, ptz?.queuedPosition, ptzRelease, releasePending, stopAllMotion]);

  if (!featureEnabled) {
    return (
      <main className={`flex min-h-[100dvh] items-center justify-center p-2 text-slate-100 ${pageBackgroundClass}`}>
        <CardFrame title="PTZ camera" bodyClassName="space-y-1 p-2 text-sm">
          <p>The PTZ camera is not available.</p>
          <button type="button" className="button-dark w-full" onClick={() => navigate('/')}>Return to driver page</button>
        </CardFrame>
      </main>
    );
  }

  return (
    <main className={`h-[100dvh] w-full overflow-hidden text-slate-100 ${pageBackgroundClass}`}>
      {/* The fullscreen CardFrame remains the structural shell. Painting its otherwise
          transparent body is what lets every desktop and mobile PTZ composition share one
          continuous pattern without threading theme props into each individual child panel. */}
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
        bodyClassName={`relative min-h-0 flex-1 ${pageBackgroundClass}`}
      >
        {isMobile ? (
          layout === 'mobile-landscape' ? (
            <PtzMobileLandscape ptz={ptz} onClose={releaseAndClose} releasePending={releasePending} />
          ) : (
            <PtzMobilePortrait ptz={ptz} onClose={releaseAndClose} releasePending={releasePending} />
          )
        ) : (
          <PtzDesktopFullscreen ptz={ptz} releasePending={releasePending} />
        )}
      </CardFrame>
    </main>
  );
}

export default function PtzQueueCard() {
  const featureEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'ptzCamera'));
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const role = useSessionSelector((state) => state.session?.role || null);
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const { ptzClaim, ptzRelease } = useSessionActions();
  const navigate = useNavigate();
  const lookupUser = usePtzQueueLookup(ptz);
  const { queue, currentId, nextId } = normalizePtzQueue(ptz);
  const now = useSharedClock(1000, Boolean(ptz?.deadline));
  const [pending, setPending] = useState(false);
  const canUse = Boolean(ptz?.canUse || isVerified || role === 'admin' || role === 'lockdown');
  const isParticipant = Boolean(ptz?.isOperator || ptz?.queuedPosition);
  const timerLabel = ptz?.isOperator && ptz?.deadline ? `${formatRemaining(ptz.deadline, now)} left` : '';

  if (!featureEnabled) return null;

  const handleRequest = async () => {
    if (!canUse || pending) return;
    if (isParticipant) {
      navigate('/ptz');
      return;
    }
    setPending(true);
    try {
      const response = await ptzClaim();
      /*
        The server is authoritative for whether the click became an active turn
        or a queued wait. Open only after it confirms one of those states so a
        dock-guard rejection does not strand the user in fullscreen.
      */
      if (response?.state?.isOperator || response?.state?.queuedPosition) {
        navigate('/ptz');
      }
    } catch (err) {
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
  );
}
