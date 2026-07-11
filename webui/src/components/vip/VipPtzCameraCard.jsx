// Vip PTZ Camera Card
// Purpose: Provides the verified-user entry point and fullscreen controller for the single Reolink PTZ camera.
// Scope: Owns PTZ UI state only; server-side PTZ ownership, rover handoff, and command authorization remain authoritative.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaArrowDown, FaArrowLeft, FaArrowRight, FaArrowUp, FaSearchMinus, FaSearchPlus, FaStop } from 'react-icons/fa';
import CardFrame from '../CardFrame/index.jsx';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { usePtzCameraSnapshot } from '../../hooks/usePtzCameraSnapshot.js';
import { useVideoRequests } from '../../hooks/useVideoRequests.js';
import { WhepPlayer } from '../../lib/whepPlayer.js';
import { isFeatureEnabled } from '../../lib/features.js';
import { innerFlowClass } from './constants.js';

const PTZ_CAMERA_ID = 'ptz-camera';

function formatRemaining(deadline) {
  const remaining = Math.max(0, Math.ceil((Number(deadline || 0) - Date.now()) / 1000));
  if (!remaining) return '--';
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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

function ControlButton({ title, children, onHold, className = '' }) {
  const activeRef = useRef(false);

  const start = useCallback(
    (event) => {
      event.preventDefault();
      activeRef.current = true;
      onHold?.('start');
    },
    [onHold],
  );

  const stop = useCallback(
    (event) => {
      event?.preventDefault?.();
      if (!activeRef.current) return;
      activeRef.current = false;
      onHold?.('stop');
    },
    [onHold],
  );

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      className={`button-dark flex h-10 min-w-10 items-center justify-center text-sm ${className}`}
    >
      {children}
    </button>
  );
}

function PtzLiveVideo({ enabled }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const retryTimerRef = useRef(null);
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
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        if (['error', 'failed', 'disconnected', 'closed'].includes(String(nextStatus || '').toLowerCase())) {
          scheduleRetry();
        }
      },
      receiveAudio: false,
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
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" muted playsInline autoPlay />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-slate-100">
        {source?.error || status}
      </div>
    </div>
  );
}

function PtzController({ open, onClose }) {
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const isOperator = Boolean(ptz?.isOperator);
  const { ptzMove, ptzStop, ptzSpotlight, ptzIr, ptzRelease } = useSessionActions();
  const snapshot = usePtzCameraSnapshot({ enabled: open && !isOperator });
  const [busy, setBusy] = useState('');

  const sendMove = useCallback(
    (payload) => {
      ptzMove(payload).catch(() => {});
    },
    [ptzMove],
  );

  const stopMotion = useCallback(() => {
    ptzStop().catch(() => {});
  }, [ptzStop]);

  const holdMove = useCallback(
    (payload) => (phase) => {
      if (phase === 'start') sendMove(payload);
      else stopMotion();
    },
    [sendMove, stopMotion],
  );

  if (!open) return null;

  const toggleSpotlight = async () => {
    setBusy('spotlight');
    try {
      await ptzSpotlight({ state: ptz?.light?.state ? 0 : 1 });
    } finally {
      setBusy('');
    }
  };

  const toggleIr = async () => {
    setBusy('ir');
    try {
      await ptzIr({ state: ptz?.ir?.state === 'Off' ? 'Auto' : 'Off' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex bg-black text-slate-100">
      <main className="relative flex min-w-0 flex-1 items-center justify-center bg-black">
        {isOperator ? <PtzLiveVideo enabled /> : <PtzSnapshotPreview feed={snapshot} label={ptz?.name || 'PTZ Camera'} />}
      </main>
      <aside className="flex w-72 shrink-0 flex-col gap-1 border-l border-slate-700 bg-neutral-950 p-2 text-sm">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{ptz?.name || 'PTZ Camera'}</p>
            <p className="truncate text-xs text-slate-400">{isOperator ? 'operator' : 'snapshot view'}</p>
          </div>
          <button type="button" className="button-dark text-xs" onClick={onClose}>Close</button>
        </div>
        <div className="surface-muted space-y-0.5 p-1 text-xs">
          <div className="flex justify-between gap-1"><span>Operator</span><span className="truncate text-slate-200">{ptz?.operatorLabel || 'none'}</span></div>
          <div className="flex justify-between gap-1"><span>Remaining</span><span>{formatRemaining(ptz?.deadline)}</span></div>
          <div className="flex justify-between gap-1"><span>Spotlight</span><span>{ptz?.light?.state ? 'On' : 'Off'}</span></div>
          <div className="flex justify-between gap-1"><span>IR</span><span>{ptz?.ir?.state || '--'}</span></div>
        </div>
        {isOperator ? (
          <>
            <div className="grid grid-cols-3 gap-1">
              <div />
              <ControlButton title="Tilt up" onHold={holdMove({ tilt: 0.55 })}><FaArrowUp /></ControlButton>
              <div />
              <ControlButton title="Pan left" onHold={holdMove({ pan: -0.55 })}><FaArrowLeft /></ControlButton>
              <ControlButton title="Stop" onHold={(phase) => phase === 'start' && stopMotion()}><FaStop /></ControlButton>
              <ControlButton title="Pan right" onHold={holdMove({ pan: 0.55 })}><FaArrowRight /></ControlButton>
              <div />
              <ControlButton title="Tilt down" onHold={holdMove({ tilt: -0.55 })}><FaArrowDown /></ControlButton>
              <div />
            </div>
            <div className="grid grid-cols-2 gap-1">
              <ControlButton title="Zoom in" onHold={holdMove({ zoom: 0.55 })}><FaSearchPlus /></ControlButton>
              <ControlButton title="Zoom out" onHold={holdMove({ zoom: -0.55 })}><FaSearchMinus /></ControlButton>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" className="button-dark text-xs" disabled={busy === 'spotlight'} onClick={toggleSpotlight}>
                Spotlight {ptz?.light?.state ? 'off' : 'on'}
              </button>
              <button type="button" className="button-dark text-xs" disabled={busy === 'ir'} onClick={toggleIr}>
                IR {ptz?.ir?.state === 'Off' ? 'auto' : 'off'}
              </button>
            </div>
            <button type="button" className="button-dark mt-auto text-xs" onClick={() => ptzRelease().finally(onClose)}>
              Release camera
            </button>
          </>
        ) : (
          <p className="surface-muted p-2 text-xs text-slate-400">Live PTZ controls unlock when your camera turn is active.</p>
        )}
      </aside>
    </div>
  );
}

export default function VipPtzCameraCard({ onMessage, fullWidth = false }) {
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
        <div className={innerFlowClass}>
          <PtzSnapshotPreview feed={snapshot} label={ptz?.name || 'PTZ Camera'} />
          <div className="grid w-full grid-cols-2 gap-1 text-left text-xs">
            <div className="surface-muted p-1">
              <p className="text-slate-500">State</p>
              <p className="truncate text-slate-100">{queueText}</p>
            </div>
            <div className="surface-muted p-1">
              <p className="text-slate-500">Remaining</p>
              <p className="text-slate-100">{formatRemaining(ptz?.deadline)}</p>
            </div>
          </div>
          {ptz?.blocked?.message ? (
            <p className="w-full rounded border border-amber-500/50 bg-amber-950/40 p-1 text-xs text-amber-100">
              {ptz.blocked.message}
            </p>
          ) : null}
          <div className="flex w-full flex-wrap justify-center gap-1">
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
                className="button-dark text-xs"
                disabled={pending || !isVerified}
                onClick={ptz?.queuedPosition ? handleRelease : handleClaim}
              >
                {ptz?.queuedPosition ? 'Leave queue' : pending ? 'Requesting...' : 'Claim camera'}
              </button>
            )}
          </div>
        </div>
      </CardFrame>
      <PtzController open={controllerOpen} onClose={() => setControllerOpen(false)} />
    </>
  );
}
