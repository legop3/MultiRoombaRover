// Alert Feed
// Purpose: Defines the Alert Feed module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import ChatMessageRow from '../ChatMessageRow/index.jsx';
import ChatTypingRow from '../ChatTypingRow/index.jsx';
import ButtonBoxTile from '../ButtonBoxTile/index.jsx';

const LIFETIME_MS = 3000;
const BUTTONBOX_LIFETIME_MS = 3500;
const DEFAULT_COLOR = '#2196f3';

function buildKey(alert) {
  if (alert.id) return alert.id;
  if (alert.timestamp) return `${alert.timestamp}-${alert.message}`;
  return `${alert.title || 'alert'}-${alert.message}`;
}

export default function AlertFeed({ scale = 1 }) {
  const alerts = useSessionSelector((state) => state.alerts);
  const buttonBoxButtons = useSessionSelector((state) => state.session?.buttonBox?.buttons ?? []);
  const { pushAlert } = useSessionActions();
  const socket = useSocket();
  const [now, setNow] = useState(() => Date.now());

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

  const latest = useMemo(() => alerts.slice(-12).map((alert) => ({ alert, key: buildKey(alert) })), [alerts]);

  const { visible, nextExpiryAt } = useMemo(() => {
    const visibleByKey = new Map();
    let soonestExpiryAt = null;

    latest.forEach((item) => {
      const receivedAt = item.alert.receivedAt ?? item.alert.timestamp ?? 0;
      const age = now - receivedAt;
      const lifetimeMs = Number.isFinite(item.alert.lifetimeMs) ? item.alert.lifetimeMs : LIFETIME_MS;
      const expiryAt = receivedAt + lifetimeMs;

      if (age <= lifetimeMs) {
        visibleByKey.set(item.key, { ...item, age });
        /*
          Alerts do not render a live progress value, so polling every 200ms is
          unnecessary. Tracking the earliest expiry lets this component sleep
          until one visible toast actually needs to disappear.
        */
        soonestExpiryAt = soonestExpiryAt == null ? expiryAt : Math.min(soonestExpiryAt, expiryAt);
      }
    });

    return {
      visible: Array.from(visibleByKey.values()).slice(-3),
      nextExpiryAt: soonestExpiryAt,
    };
  }, [latest, now]);

  useEffect(() => {
    if (nextExpiryAt == null) return undefined;
    /*
      The small padding avoids waking a few milliseconds before the browser's
      current Date.now value crosses the expiry boundary. Without it, React can
      render the same alert once more and schedule a second near-immediate timer.
    */
    const delayMs = Math.max(0, nextExpiryAt - Date.now()) + 25;
    const timer = setTimeout(() => setNow(Date.now()), delayMs);
    return () => clearTimeout(timer);
  }, [nextExpiryAt]);

  if (!visible.length) return null;

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
    <div className={containerClass} style={containerStyle}>
      {visible.map((toast) => (
        <AlertToast key={toast.key} alert={toast.alert} />
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
    return <ChatTypingRow message={alert.payload} />;
  }
  const rgb = hexToRgb(alert.color) || hexToRgb(DEFAULT_COLOR);
  const backgroundColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)` : 'rgba(33, 150, 243, 0.18)';
  const borderColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)` : 'rgba(33, 150, 243, 0.45)';
  return (
    <div
      className="pointer-events-auto max-w-[80vw] rounded-full border px-2 py-0.5 text-[0.7rem] leading-tight text-slate-100 shadow-sm shadow-black/30"
      style={{ backgroundColor, border: `1px solid ${borderColor}` }}
    >
      <p className="truncate text-slate-100">
        <span className="text-slate-300">{alert.title || 'Alert'}</span>
        <span className="text-slate-500"> · </span>
        <span className="text-white">{alert.message}</span>
      </p>
    </div>
  );
}
