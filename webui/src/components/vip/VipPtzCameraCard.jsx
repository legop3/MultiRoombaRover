// Vip PTZ Camera Card
// Purpose: Provides the verified-user entry point and fullscreen controller for the single Reolink PTZ camera.
// Scope: Owns PTZ UI state only; server-side PTZ ownership, rover handoff, and command authorization remain authoritative.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CardFrame from '../CardFrame/index.jsx';
import GPIOToggleControl from '../GPIOToggleControl/index.jsx';
import ControlPadPanel from '../MobileControls/ControlPadPanel.jsx';
import ReplaySourcesPanel from '../ReplaySourcesPanel/index.jsx';
import KeyPill from './VipAudioUploadCard/KeyPill.jsx';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useControlSelector } from '../../controls/index.js';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import { usePtzCameraSnapshot } from '../../hooks/usePtzCameraSnapshot.js';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { WhepPlayer } from '../../lib/whepPlayer.js';
import { isFeatureEnabled } from '../../lib/features.js';

const PTZ_CAMERA_ID = 'ptz-camera';
const PTZ_AUDIO_RETRY_MS = 1000;
const PTZ_ZOOM_SPEED = 0.55;

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

function PtzSnapshotPreview({ feed, label = 'PTZ Camera' }) {
  return (
    <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: '16 / 9' }}>
      {feed?.objectUrl ? (
        <img src={feed.objectUrl} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">Waiting for snapshot...</div>
      )}
      <div className="pointer-events-none absolute left-0 top-0 bg-black/70 px-1 py-0.5 text-xs font-semibold text-white">
        {label}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 m-1 rounded bg-black/70 px-1 py-0.5 text-[0.7rem] text-slate-100">
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

function PtzQueueList({ queue = [], operatorLabel = '' }) {
  const hasQueue = Array.isArray(queue) && queue.length > 0;
  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs">Turn queue</div>
      <div className="space-y-0.5">
        {operatorLabel ? (
          <div className="surface flex items-center justify-between gap-1 text-xs">
            <span className="text-slate-400">Now</span>
            <span className="min-w-0 truncate text-emerald-200">{operatorLabel}</span>
          </div>
        ) : null}
        {hasQueue ? queue.map((entry, index) => (
          <div key={entry.socketId || `${entry.label}-${index}`} className="surface flex items-center justify-between gap-1 text-xs">
            <span className="text-slate-400">{index + 1}</span>
            <span className="min-w-0 truncate text-slate-100">{entry.label || entry.socketId || 'queued user'}</span>
          </div>
        )) : (
          <div className="surface text-xs text-slate-400">No one waiting</div>
        )}
      </div>
    </div>
  );
}

function PtzStatePanel({ ptz, onClose, onRelease, releaseDisabled = false }) {
  const spotlightOn = isSpotlightOn(ptz?.light);
  const irMode = normalizeIrMode(ptz?.ir?.state);
  const publisher = ptz?.publisher || {};
  const publisherStatus = publisher.running
    ? `running${publisher.pid ? ` ${publisher.pid}` : ''}`
    : publisher.restartAt
      ? 'restarting'
      : publisher.lastEvent || 'stopped';
  const statusTone = ptz?.error ? 'text-amber-300' : ptz?.isOperator ? 'text-emerald-300' : 'text-slate-100';

  return (
    <CardFrame
      title="Camera state"
      actions={onClose ? <button type="button" className="button-dark text-xs" onClick={onClose}>Close</button> : null}
      bodyClassName="space-y-0.5 p-1 text-sm"
    >
      <StatusRow label="Mode" value={ptz?.isOperator ? 'operator' : ptz?.queuedPosition ? `queued ${ptz.queuedPosition}` : 'spectator'} tone={statusTone} />
      <StatusRow label="Operator" value={ptz?.operatorLabel || 'none'} />
      <StatusRow label="Remaining" value={formatRemaining(ptz?.deadline)} />
      <StatusRow label="Spotlight" value={spotlightOn ? 'On' : 'Off'} tone={spotlightOn ? 'text-emerald-300' : 'text-slate-200'} />
      <StatusRow label="Infrared mode" value={irMode} />
      <StatusRow label="Stream" value={ptz?.status || ptz?.error || 'idle'} tone={ptz?.error ? 'text-amber-300' : ''} />
      <StatusRow label="Transcoder" value={publisherStatus} tone={publisher.running ? 'text-emerald-300' : 'text-amber-300'} />
      {publisher.lastStderr ? (
        <div className="surface max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-tight text-slate-200">
          {publisher.lastStderr}
        </div>
      ) : null}
      {ptz?.blocked?.message ? (
        <div className="rounded border border-amber-500/50 bg-amber-950/40 p-1 text-xs text-amber-100">
          {ptz.blocked.message}
        </div>
      ) : null}
      {onRelease ? (
        <button type="button" className="button-dark w-full text-xs" disabled={releaseDisabled} onClick={onRelease}>
          Release camera
        </button>
      ) : null}
    </CardFrame>
  );
}

function PtzLiveVideo({ enabled }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const playTimerRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [retryVersion, setRetryVersion] = useState(0);
  const sources = useVideoRequests(
    [{ type: 'ptz', id: PTZ_CAMERA_ID, key: PTZ_CAMERA_ID }],
    { enabled, version: retryVersion },
  );
  const source = sources[PTZ_CAMERA_ID] || null;

  const scheduleRetry = useCallback(() => {
    if (!enabled || retryTimerRef.current) return;
    /*
      A failed WHEP POST consumes the short-lived video token and leaves the
      PeerConnection in a terminal state. Requesting a fresh server session is
      the simplest reliable retry path, and it matches how rover playback gets
      a new authorization token after reconnects.
    */
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRetryVersion((value) => value + 1);
    }, 1500);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !source?.url || !videoRef.current) return undefined;
    /*
      WhepPlayer already owns PeerConnection setup, low-latency hints, auth
      headers, and cleanup for rover video. Reusing it keeps PTZ video on the
      same MediaMTX browser path as the rest of the app.
    */
    const player = new WhepPlayer({
      url: source.url,
      token: source.token,
      video: videoRef.current,
      startMuted: false,
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        if (['error', 'failed', 'disconnected', 'closed'].includes(String(nextStatus || '').toLowerCase())) {
          scheduleRetry();
        }
      },
    });
    playerRef.current = player;
    player.start().catch((err) => {
      setStatus(err.message || 'error');
      scheduleRetry();
    });
    return () => {
      player.stop();
      playerRef.current = null;
    };
  }, [enabled, scheduleRetry, source?.token, source?.url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !source?.url || !video) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      playTimerRef.current = null;
      return undefined;
    }
    /*
      The server now publishes inline Opus audio on the PTZ WHEP stream. The
      shared WHEP helper starts playback once, but browsers can still reject or
      pause audible media depending on the exact timing of the fullscreen/user
      gesture. Retry the same element with muted=false so unmuting is not a
      manual DevTools-only operation.
    */
    const attemptPlay = () => {
      const target = videoRef.current;
      if (!target) return;
      target.muted = false;
      if (!target.paused && !target.ended) return;
      target.play().catch(() => {});
    };
    attemptPlay();
    playTimerRef.current = setInterval(attemptPlay, PTZ_AUDIO_RETRY_MS);
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    };
  }, [enabled, source?.url, status]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" playsInline autoPlay />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-slate-100">
        {source?.error || status}
      </div>
    </div>
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
        Mobile needs explicit zoom targets because the regular mobile drive pad
        is already used for pan/tilt. Desktop does not render these buttons; it
        uses the mapped camera up/down controls shown in the reference panel.
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
          Reuse the rover mobile movement card instead of building a second PTZ
          joystick. Its drive vector goes through the shared internal control
          layer, where the PTZ adapter already converts movement plus speed mode
          into camera pan/tilt commands.
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
          {/* Use the same key display component as the rest of the UI so PTZ
              controls read as normal mapped controls instead of custom labels. */}
          <KeyPill label={keyLabelFor(keymap, actionId)} />
        </div>
      ))}
    </CardFrame>
  );
}

function PtzController({ open, onClose, layout = 'desktop' }) {
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const isOperator = Boolean(ptz?.isOperator);
  const isMobile = layout === 'mobile-portrait' || layout === 'mobile-landscape';
  const { ptzRelease } = useSessionActions();
  const snapshot = usePtzCameraSnapshot({ enabled: open && !isOperator });
  const [releasePending, setReleasePending] = useState(false);

  if (!open) return null;

  const releaseAndClose = async () => {
    setReleasePending(true);
    try {
      await ptzRelease();
      onClose();
    } finally {
      setReleasePending(false);
    }
  };

  const desktopSidebar = (
    <>
      <div className="shrink-0">
        <PtzStatePanel
          ptz={ptz}
          onClose={onClose}
          onRelease={isOperator ? releaseAndClose : null}
          releaseDisabled={releasePending}
        />
      </div>
      <div className="shrink-0">
        <PtzQueueList queue={ptz?.queue} operatorLabel={ptz?.operatorLabel} />
      </div>
      {isOperator ? (
        <div className="shrink-0">
          <PtzLightingControls ptz={ptz} />
        </div>
      ) : (
        <div className="shrink-0">
          <CardFrame title="Controls" bodyClassName="p-1 text-xs text-slate-400">
            Live PTZ controls unlock when your camera turn is active.
          </CardFrame>
        </div>
      )}
      <div className="shrink-0">
        <PtzControlReference />
      </div>
      <div className="shrink-0">
        <ReplaySourcesPanel panelId="ptz-controller-replay" />
      </div>
    </>
  );

  const mobileSidebar = (
    <>
      <div className="shrink-0">
        <PtzMobileControlsPanel ptz={ptz} disabled={!isOperator} />
      </div>
      <div className="shrink-0">
        <ReplaySourcesPanel panelId="ptz-controller-replay-mobile" />
      </div>
      <div className="shrink-0">
        <PtzStatePanel
          ptz={ptz}
          onClose={onClose}
          onRelease={isOperator ? releaseAndClose : null}
          releaseDisabled={releasePending}
        />
      </div>
      <div className="shrink-0">
        <PtzQueueList queue={ptz?.queue} operatorLabel={ptz?.operatorLabel} />
      </div>
    </>
  );

  const sidebarWidthClass = isMobile
    ? 'grid-cols-[minmax(0,1fr)_14rem]'
    : 'grid-cols-[minmax(0,1fr)_20rem]';

  const controller = (
    <div className="fixed inset-0 z-[110] h-[100dvh] w-[100vw] overflow-hidden bg-black text-slate-100">
      <CardFrame
        hideHeader
        fillHeight
        clipOverflow={false}
        className="h-[100dvh] w-[100vw] rounded-none border-0 !bg-black"
        bodyClassName={`grid h-full min-h-0 overflow-hidden ${sidebarWidthClass}`}
      >
        <main className="relative min-h-0 min-w-0 bg-black">
          {isOperator ? <PtzLiveVideo enabled /> : <PtzSnapshotPreview feed={snapshot} label={ptz?.name || 'PTZ Camera'} />}
        </main>
        <aside className="flex h-full min-h-0 items-stretch overflow-hidden border-l border-neutral-600 bg-neutral-950 text-sm">
          <div className="flex min-h-0 w-full flex-col gap-0.5 overflow-y-auto p-0.5">
            {isMobile ? mobileSidebar : desktopSidebar}
          </div>
        </aside>
      </CardFrame>
    </div>
  );

  /*
    The controller is a true fullscreen surface, so mount it directly under
    document.body instead of inside the VIP tab/card tree. That keeps tab panel
    spacing, mobile banners, and parent overflow rules from creating visible
    gaps around a fixed-position camera interface.
  */
  return createPortal(controller, document.body);
}

export default function VipPtzCameraCard({ onMessage, fullWidth = false, layout = 'desktop' }) {
  const featureEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'ptzCamera'));
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const { ptzClaim, ptzRelease } = useSessionActions();
  const snapshot = usePtzCameraSnapshot({ enabled: Boolean(featureEnabled) });
  const [controllerOpen, setControllerOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const wrapClass = fullWidth ? 'w-full' : 'mx-auto w-full max-w-xl';
  const queueText = useMemo(() => {
    if (ptz?.isOperator) return 'Your turn';
    if (ptz?.queuedPosition) return `Queue position ${ptz.queuedPosition}`;
    if (ptz?.operatorLabel) return `${ptz.operatorLabel} operating`;
    return 'Available';
  }, [ptz?.isOperator, ptz?.operatorLabel, ptz?.queuedPosition]);

  if (!featureEnabled) return null;

  const handleClaim = async () => {
    setPending(true);
    onMessage?.('');
    try {
      const response = await ptzClaim();
      /*
        Requesting the PTZ camera is also the user's intent to enter camera mode.
        Open the controller immediately for operators and queued users so the
        camera surface does not require a second, redundant "open" click.
      */
      setControllerOpen(true);
      if (response?.state?.isOperator) onMessage?.('PTZ camera turn active.');
      else if (response?.state?.queuedPosition) onMessage?.(`Joined PTZ queue at position ${response.state.queuedPosition}.`);
    } catch (err) {
      onMessage?.(err.message || 'PTZ request failed.');
    } finally {
      setPending(false);
    }
  };

  const handleRelease = async () => {
    setPending(true);
    try {
      await ptzRelease();
      onMessage?.('Left PTZ camera.');
    } catch (err) {
      onMessage?.(err.message || 'Failed to leave PTZ camera.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <CardFrame title="PTZ camera" className={wrapClass} bodyClassName="text-sm text-slate-300">
        <div className="grid w-full gap-0.5 md:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)] md:items-start">
          <PtzSnapshotPreview feed={snapshot} label={ptz?.name || 'PTZ Camera'} />
          <div className="flex w-full min-w-0 flex-col gap-0.5">
            <div className="grid w-full grid-cols-2 gap-0.5 text-left text-xs">
              <div className="surface-muted p-1">
                <p className="text-slate-500">State</p>
                <p className="truncate text-slate-100">{queueText}</p>
              </div>
              <div className="surface-muted p-1">
                <p className="text-slate-500">Remaining</p>
                <p className="text-slate-100">{formatRemaining(ptz?.deadline)}</p>
              </div>
              <div className="surface-muted p-1">
                <p className="text-slate-500">Spotlight</p>
                <p className="truncate text-slate-100">{isSpotlightOn(ptz?.light) ? 'On' : 'Off'}</p>
              </div>
              <div className="surface-muted p-1">
                <p className="text-slate-500">Infrared</p>
                <p className="truncate text-slate-100">{normalizeIrMode(ptz?.ir?.state)}</p>
              </div>
            </div>
            <PtzQueueList queue={ptz?.queue} operatorLabel={ptz?.operatorLabel} />
            {ptz?.blocked?.message ? (
              <p className="w-full rounded border border-amber-500/50 bg-amber-950/40 p-1 text-xs text-amber-100">
                {ptz.blocked.message}
              </p>
            ) : null}
            <div className="grid w-full grid-cols-2 gap-0.5">
              {ptz?.isOperator ? (
                <>
                  <button type="button" className="button-dark text-xs" onClick={() => setControllerOpen(true)}>
                    Open controller
                  </button>
                  <button type="button" className="button-dark text-xs" disabled={pending} onClick={handleRelease}>
                    Release
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button-dark col-span-2 text-xs"
                  disabled={pending || !isVerified}
                  onClick={ptz?.queuedPosition ? handleRelease : handleClaim}
                >
                  {ptz?.queuedPosition ? 'Leave queue' : pending ? 'Requesting...' : 'Claim camera'}
                </button>
              )}
            </div>
          </div>
        </div>
      </CardFrame>
      <PtzController open={controllerOpen} onClose={() => setControllerOpen(false)} layout={layout} />
    </>
  );
}
