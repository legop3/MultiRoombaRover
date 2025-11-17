import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';

const LIFETIME_MS = 5000;

function buildKey(alert) {
  if (alert.id) return alert.id;
  if (alert.timestamp) return `${alert.timestamp}-${alert.message}`;
  return `${alert.title || 'alert'}-${alert.message}`;
}

export default function AlertFeed() {
  const { alerts } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const latest = useMemo(() => alerts.slice(-5).map((alert) => ({ alert, key: buildKey(alert) })), [alerts]);

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

  return (
    <div className="pointer-events-none fixed top-1 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-1">
      {visible.map((toast) => (
        <AlertToast key={toast.key} alert={toast.alert} />
      ))}
    </div>
  );
}

function AlertToast({ alert }) {
  const colorClasses =
    alert.color === 'error'
      ? 'bg-red-500/30 text-red-100'
      : alert.color === 'warn'
      ? 'bg-amber-500/30 text-amber-100'
      : 'bg-emerald-500/30 text-emerald-100';
  return (
    <div className={`pointer-events-auto rounded-sm px-1 py-1 text-[0.75rem] shadow-lg shadow-black/60 ${colorClasses}`}>
      <p className="text-[0.65rem] text-slate-300">{alert.title || 'Alert'}</p>
      <p className="text-sm text-white">{alert.message}</p>
    </div>
  );
}
