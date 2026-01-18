import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import ChatMessageRow from './ChatMessageRow.jsx';

const LIFETIME_MS = 3000;
const DEFAULT_COLOR = '#2196f3';

function buildKey(alert) {
  if (alert.id) return alert.id;
  if (alert.timestamp) return `${alert.timestamp}-${alert.message}`;
  return `${alert.title || 'alert'}-${alert.message}`;
}

export default function AlertFeed({ scale = 1 }) {
  const { alerts } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const latest = useMemo(() => alerts.slice(-3).map((alert) => ({ alert, key: buildKey(alert) })), [alerts]);

  useEffect(() => {
    if (!latest.length) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, [latest.length]);

  const visible = latest
    .map((item) => ({
      ...item,
      age: now - (item.alert.receivedAt ?? item.alert.timestamp ?? 0),
    }))
    .filter((item) => item.age <= LIFETIME_MS);

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
  if (alert.kind === 'chat' && alert.payload) {
    return <ChatMessageRow message={alert.payload} />;
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
