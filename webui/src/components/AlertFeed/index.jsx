import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import useLayoutMode from '../../hooks/useLayoutMode.js';
import AlertContent from './AlertContent.jsx';
import useAlertEvents from './useAlertEvents.js';

const RECENT_ALERT_LOOKBACK = 12;

function getAlertKey(alert) {
  return alert.id || (alert.timestamp
    ? `${alert.timestamp}-${alert.message}`
    : `${alert.title || 'alert'}-${alert.message}`);
}

export default function AlertFeed({ scale = 1, opacity = 0.6 }) {
  const layout = useLayoutMode();
  const maxVisibleToasts = layout === 'mobile-portrait' || layout === 'mobile-landscape' ? 4 : 10;
  const alerts = useSessionSelector((state) => state.alerts);
  const [toasts, setToasts] = useState([]);
  const seenRef = useRef(new Set());
  useAlertEvents();

  useEffect(() => {
    // Session history preserves object identity, including distinct arrivals
    // with the same id and timestamp. Dismissed alerts must not reappear.
    const incoming = alerts.slice(-RECENT_ALERT_LOOKBACK).filter((alert) => !seenRef.current.has(alert));
    seenRef.current = new Set(alerts);
    setToasts((current) => {
      if (!incoming.length && current.length <= maxVisibleToasts) return current;
      const next = new Map(current.map((alert) => [getAlertKey(alert), alert]));
      for (const alert of incoming) {
        const key = getAlertKey(alert);
        // Refreshed alerts move to the newest slot and receive a fresh lifetime.
        next.delete(key);
        next.set(key, alert);
      }
      return [...next.values()].slice(-maxVisibleToasts);
    });
  }, [alerts, maxVisibleToasts]);

  const dismiss = useCallback((alert) => {
    setToasts((current) => current.filter((entry) => entry !== alert));
  }, []);

  if (!toasts.length) return null;

  return (
    <div
      className="pointer-events-none fixed top-0.5 left-1/2 z-50 flex w-max max-w-[80vw] flex-col items-center gap-0.5"
      style={{ transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center' }}
      aria-live="polite"
    >
      {toasts.map((alert) => (
        <AlertToast key={getAlertKey(alert)} alert={alert} opacity={opacity} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function AlertToast({ alert, opacity, onDismiss }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remainingRef = useRef(0);
  const paused = hovered || focused;

  useEffect(() => {
    remainingRef.current = Number.isFinite(alert.lifetimeMs) ? alert.lifetimeMs : 3000;
  }, [alert]);

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => onDismiss(alert), Math.max(0, remainingRef.current));
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [alert, paused, onDismiss]);

  return (
    <div
      className="pointer-events-auto w-max max-w-full"
      style={{ opacity }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        // Moving focus between controls inside the toast must not resume expiry.
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <AlertContent alert={alert} />
    </div>
  );
}
