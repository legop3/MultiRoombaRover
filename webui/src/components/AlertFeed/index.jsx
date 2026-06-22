// Alert Feed
// Purpose: Defines the Alert Feed module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import ChatMessageRow from '../ChatMessageRow/index.jsx';
import ButtonBoxTile from '../ButtonBoxTile/index.jsx';

const LIFETIME_MS = 3000;
const BUTTONBOX_LIFETIME_MS = 5000;
const BARCODE_SCAN_LIFETIME_MS = 10 * 1000;
const MAX_VISIBLE_TOASTS = 6;
const RECENT_ALERT_LOOKBACK = 12;
const DEFAULT_COLOR = '#2196f3';

function buildKey(alert) {
  if (alert.id) return alert.id;
  if (alert.timestamp) return `${alert.timestamp}-${alert.message}`;
  return `${alert.title || 'alert'}-${alert.message}`;
}

function getAlertLifetime(alert) {
  return Number.isFinite(alert?.lifetimeMs) ? alert.lifetimeMs : LIFETIME_MS;
}

function buildAlertToken(alert, key) {
  /*
    A keyed alert such as a barcode scan intentionally reuses the same id so the
    visual slot can be refreshed in place. The token must therefore include the
    arrival timestamp too; otherwise a new scan with the same id would look like
    the same toast and would not get a fresh timer.
  */
  const receivedAt = alert?.receivedAt ?? '';
  const timestamp = alert?.timestamp ?? '';
  const title = alert?.title ?? '';
  const message = alert?.message ?? '';
  return `${key}:${receivedAt}:${timestamp}:${title}:${message}`;
}

function buildToastRecord(item) {
  const lifetimeMs = getAlertLifetime(item.alert);
  const expiresAt = Date.now() + lifetimeMs;

  return {
    key: item.key,
    alert: item.alert,
    expiresAt,
    remainingMs: lifetimeMs,
    paused: false,
  };
}

function getToastRgb(alert) {
  return hexToRgb(alert?.color) || hexToRgb(DEFAULT_COLOR);
}

function getToastAccent(alert) {
  const rgb = getToastRgb(alert);
  return rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : DEFAULT_COLOR;
}

function isGenericAlert(alert) {
  /*
    The shell needs to know which alerts use the fallback title/message renderer
    because those alerts historically carried their own color-tinted surface.
    Matching the same payload guards used by AlertToast keeps the shell styling
    aligned with the renderer that will actually be selected below.
  */
  if (alert?.kind === 'buttonbox-active' && alert.payload) return false;
  if (alert?.kind === 'chat' && alert.payload) return false;
  if (alert?.kind === 'chat-typing' && alert.payload) return false;
  if (alert?.kind === 'barcode-scan' && alert.payload) return false;
  return true;
}

export default function AlertFeed({ scale = 1 }) {
  const alerts = useSessionSelector((state) => state.alerts);
  const buttonBoxButtons = useSessionSelector((state) => state.session?.buttonBox?.buttons ?? []);
  const { pushAlert } = useSessionActions();
  const socket = useSocket();
  const [toasts, setToasts] = useState([]);
  const latestTokensRef = useRef(new Set());
  const timersRef = useRef(new Map());

  const clearToastTimer = useCallback((key) => {
    const timer = timersRef.current.get(key);
    if (!timer) return;
    clearTimeout(timer);
    timersRef.current.delete(key);
  }, []);

  const removeToast = useCallback(
    (key) => {
      clearToastTimer(key);
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.key !== key));
    },
    [clearToastTimer],
  );

  const scheduleToastRemoval = useCallback(
    (key, delayMs) => {
      clearToastTimer(key);
      /*
        Each toast owns exactly one removal timeout. This is cheaper and simpler
        than polling all visible alerts for progress/fade state, and it still
        lets hover/focus pause by clearing the one timer for the interacted row.
      */
      const timer = setTimeout(() => removeToast(key), Math.max(0, delayMs));
      timersRef.current.set(key, timer);
    },
    [clearToastTimer, removeToast],
  );

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    function onButtonIncrement(payload = {}) {
      const buttonId = Number(payload.buttonId);
      if (!Number.isFinite(buttonId) || buttonId < 1 || buttonId > 4) return;
      const buttons = Array.isArray(buttonBoxButtons) ? buttonBoxButtons : [];
      const button = buttons.find((entry) => Number(entry?.id) === buttonId) || {};
      const count = Number.isFinite(payload.count) ? payload.count : Number(button.count) || 0;
      const goal = Number.isFinite(button.goal) ? button.goal : 0;
      const rewardNumber = Number.isFinite(button.rewardNumber) ? button.rewardNumber : '?';
      const rewardName =
        typeof button.rewardName === 'string' && button.rewardName.trim()
          ? button.rewardName.trim()
          : 'Unassigned';
      pushAlert({
        id: `buttonbox-active-${buttonId}`,
        kind: 'buttonbox-active',
        lifetimeMs: BUTTONBOX_LIFETIME_MS,
        payload: { buttonId, count, goal, rewardNumber, rewardName },
      });
    }
    socket.on('buttonBox:increment', onButtonIncrement);
    return () => {
      socket.off('buttonBox:increment', onButtonIncrement);
    };
  }, [pushAlert, buttonBoxButtons, socket]);

  useEffect(() => {
    function onBarcodeScanned(payload = {}) {
      const label = typeof payload.label === 'string' && payload.label.trim()
        ? payload.label.trim()
        : payload.code || 'unknown barcode';
      /*
        Barcode scans use a fixed alert id because the scanner can fire quickly
        during games. Reusing the id makes the newest scan replace the previous
        barcode popup in AlertFeed's keyed visible map instead of building a
        stack of old scan cards that would hide the current wiki link.
      */
      pushAlert({
        id: 'barcode-scan-active',
        kind: 'barcode-scan',
        lifetimeMs: BARCODE_SCAN_LIFETIME_MS,
        payload: {
          ...payload,
          label,
        },
      });
    }

    socket.on('barcode:scanned', onBarcodeScanned);
    return () => {
      socket.off('barcode:scanned', onBarcodeScanned);
    };
  }, [pushAlert, socket]);

  const latest = useMemo(
    () =>
      alerts.slice(-RECENT_ALERT_LOOKBACK).map((alert) => {
        const key = buildKey(alert);
        return {
          alert,
          key,
          token: buildAlertToken(alert, key),
        };
      }),
    [alerts],
  );

  useEffect(() => {
    /*
      The processed-token set is captured before scheduling the state update
      because React may run the functional updater after this effect continues.
      Reading latestTokensRef.current inside the updater would race with the ref
      assignment below and could make brand-new alerts look already processed,
      leaving the local toast list empty.
    */
    const previousTokens = latestTokensRef.current;
    const newItems = latest.filter((item) => !previousTokens.has(item.token));

    if (newItems.length) {
      setToasts((currentToasts) => {
        const nextByKey = new Map(currentToasts.map((toast) => [toast.key, toast]));

        newItems.forEach((item) => {
          /*
            Setting an existing Map key updates its value but keeps its original
            insertion slot. Deleting first makes refreshed keyed alerts behave
            like new notifications visually, which is what operators expect when
            the barcode lane or a button-box lane receives a fresh event.
          */
          nextByKey.delete(item.key);
          nextByKey.set(item.key, buildToastRecord(item));
        });

        /*
          The newest records are the only ones that should consume feed slots.
          Older active records are dropped immediately so a burst of alerts
          cannot cover the rest of the rover interface.
        */
        const nextToasts = Array.from(nextByKey.values());
        const activeKeys = nextToasts.slice(-MAX_VISIBLE_TOASTS).map((toast) => toast.key);
        const activeKeySet = new Set(activeKeys);

        return nextToasts.filter((toast) => activeKeySet.has(toast.key));
      });

      newItems.forEach((item) => {
        scheduleToastRemoval(item.key, getAlertLifetime(item.alert));
      });
    }

    latestTokensRef.current = new Set(latest.map((item) => item.token));
  }, [latest, scheduleToastRemoval]);

  const pauseToast = useCallback((key) => {
    const toast = toasts.find((entry) => entry.key === key);
    if (!toast || toast.paused) return;
    const remainingMs = Math.max(0, toast.expiresAt - Date.now());

    clearToastTimer(key);
    setToasts((currentToasts) =>
      currentToasts.map((toast) => {
        if (toast.key !== key || toast.paused) return toast;

        /*
          Remaining time is captured at the moment interaction begins, not at the
          previous render. That makes hover/focus pauses exact enough that a
          toast cannot expire while the user is moving toward a link or dismiss
          button inside it.
        */
        return {
          ...toast,
          paused: true,
          remainingMs,
        };
      }),
    );
  }, [clearToastTimer, toasts]);

  const resumeToast = useCallback((key) => {
    const toast = toasts.find((entry) => entry.key === key);
    if (!toast || !toast.paused) return;
    const startedAt = Date.now();
    const remainingMs = Math.max(0, toast.remainingMs);

    setToasts((currentToasts) =>
      currentToasts.map((toast) => {
        if (toast.key !== key || !toast.paused) return toast;
        return {
          ...toast,
          paused: false,
          expiresAt: startedAt + remainingMs,
          remainingMs,
        };
      }),
    );
    scheduleToastRemoval(key, remainingMs);
  }, [scheduleToastRemoval, toasts]);

  const dismissToast = useCallback((key) => {
    removeToast(key);
  }, [removeToast]);

  if (!toasts.length) return null;

  const containerStyle =
    scale === 1
      ? undefined
      : {
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: 'top center',
        };
  const containerClass =
    scale === 1
      ? 'pointer-events-none fixed top-0.5 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-0.5'
      : 'pointer-events-none fixed top-0.5 left-1/2 z-50 flex flex-col gap-0.5';

  return (
    <div className={containerClass} style={containerStyle} aria-live="polite">
      {toasts.map((toast) => (
        <AlertToastShell
          key={toast.key}
          toast={toast}
          onDismiss={dismissToast}
          onPause={pauseToast}
          onResume={resumeToast}
        />
      ))}
    </div>
  );
}

function hexToRgb(hex) {
  const safe = typeof hex === 'string' ? hex.trim() : '';
  const match = /^#?([0-9a-fA-F]{6})$/.exec(safe);
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function getSafeWikiUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return '';

  try {
    /*
      Wiki links are operator-authored registry data, but this still normalizes
      them before rendering an anchor. Allowing only http/https avoids turning a
      barcode registry typo into a javascript: link while still supporting both
      absolute URLs and local wiki paths such as /wiki/object-name.
    */
    const parsed = new URL(text, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function AlertToastShell({ toast, onDismiss, onPause, onResume }) {
  const accent = getToastAccent(toast.alert);
  const generic = isGenericAlert(toast.alert);
  const rgb = getToastRgb(toast.alert);
  const genericBackgroundColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)` : 'rgba(33, 150, 243, 0.18)';
  const genericBorderColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)` : 'rgba(33, 150, 243, 0.45)';
  const shellClass = [
    'pointer-events-auto w-fit max-w-[80vw] overflow-hidden rounded-md shadow-sm shadow-black/40',
    generic ? '' : 'border border-white/10 bg-black/75',
  ].join(' ');

  return (
    <div
      className={shellClass}
      onMouseEnter={() => onPause(toast.key)}
      onMouseLeave={() => onResume(toast.key)}
      onFocusCapture={() => onPause(toast.key)}
      onBlurCapture={() => onResume(toast.key)}
      style={
        generic
          ? {
              /*
        Generic alerts keep the same color math they used before the shared
        shell was introduced. Putting it on the shell restores the original
        brightness while still leaving room for the side dismiss column.
              */
              backgroundColor: genericBackgroundColor,
              border: `1px solid ${genericBorderColor}`,
            }
          : undefined
      }
    >
      <div className="flex min-w-0 items-stretch">
        <div className="min-w-0 flex-1">
          <AlertToast alert={toast.alert} />
        </div>
        <div
          className={[
            'flex w-5 shrink-0 flex-col items-center justify-start gap-0.5 border-l py-0.5',
            generic ? '' : 'border-white/10 bg-black/20',
          ].join(' ')}
          style={
            generic
              ? {
                  borderLeftColor: genericBorderColor,
                  backgroundColor: 'rgba(0, 0, 0, 0.08)',
                }
              : undefined
          }
        >
          <button
            type="button"
            className="flex h-4 w-4 items-center justify-center rounded-sm text-xs leading-none text-slate-300 hover:bg-white/10 hover:text-white focus:bg-white/10 focus:text-white focus:outline-none focus:ring-1"
            style={{ '--tw-ring-color': accent }}
            onClick={() => onDismiss(toast.key)}
            title="Dismiss alert"
            aria-label="Dismiss alert"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

function BarcodeScanToast({ payload }) {
  const wikiUrl = getSafeWikiUrl(payload?.wikiUrl);
  const label = payload?.label || payload?.code || 'unknown barcode';

  return (
    <div className="pointer-events-auto max-w-[80vw] rounded-md bg-neutral-800 px-2 py-1 text-l leading-tight text-slate-100">
      <style>
        {`
          @keyframes barcode-wiki-flat-flash {
            0%, 100% {
              background: rgb(233, 186, 14);
              color: rgb(71, 144, 253);
            }
            50% {
              background: rgb(125, 49, 255);
              color: rgb(246, 250, 211);
            }
          }
        `}
      </style>
      <p className="flex flex-wrap items-center gap-0.5 text-slate-100">
        <span className="font-semibold text-slate-300 pr-1">Barcode scanned:</span>
        <span className="font-semibold text-white">{label}</span>
        {wikiUrl ? (
          <a
            href={wikiUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md ml-0.5 px-2 py-1 text-xl font-semibold leading-tight tracking-normal"
            style={{ animation: 'barcode-wiki-flat-flash 0.35s steps(1, end) infinite' }}
          >
            Wiki link
          </a>
        ) : null}
      </p>
    </div>
  );
}

function AlertToast({ alert }) {
  if (alert.kind === 'buttonbox-active' && alert.payload) {
    const payload = alert.payload;
    return (
      <div className="pointer-events-none w-[12.5rem]">
        <ButtonBoxTile
          buttonId={payload.buttonId}
          count={payload.count}
          goal={payload.goal}
          rewardNumber={payload.rewardNumber}
          rewardName={payload.rewardName}
          className="bg-cyan-900/45"
        />
      </div>
    );
  }
  if (alert.kind === 'chat' && alert.payload) {
    return <ChatMessageRow message={alert.payload} />;
  }
  if (alert.kind === 'chat-typing' && alert.payload) {
    return <ChatMessageRow message={alert.payload} variant="typing" />;
  }
  if (alert.kind === 'barcode-scan' && alert.payload) {
    return <BarcodeScanToast payload={alert.payload} />;
  }
  return (
    <div
      /*
        Generic alerts are the payloads that directly provide title/message/color
        instead of a richer custom renderer. The surrounding shell owns their
        color-tinted background so the dismiss column and content share one
        continuous surface while this renderer stays responsible for one line of
        compact title/message text.
      */
      className="pointer-events-auto min-w-0 max-w-[24rem] px-1.5 py-0.5 text-left text-[0.72rem] leading-tight text-slate-100"
    >
      <p className="truncate text-slate-100">
        <span className="font-semibold text-slate-300">{alert.title || 'Alert'}</span>
        <span className="text-slate-500"> · </span>
        <span className="text-white">{alert.message}</span>
      </p>
    </div>
  );
}
