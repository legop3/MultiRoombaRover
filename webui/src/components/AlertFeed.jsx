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
    <div className="pointer-events-none fixed top-2 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
      {visible.map((toast) => (
        <AlertToast key={toast.key} alert={toast.alert} />
      ))}
    </div>
  );
}

function AlertToast({ alert }) {
  const colorClasses =
    alert.color === 'error'
      ? 'border-red-500/50 bg-red-500/20 text-red-100'
      : alert.color === 'warn'
      ? 'border-amber-500/50 bg-amber-500/20 text-amber-100'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100';
  return (
    <div className={`pointer-events-auto rounded-md border px-3 py-2 text-[0.75rem] shadow-lg shadow-black/60 ${colorClasses}`}>
      <p className="text-[0.6rem] uppercase tracking-[0.4em] opacity-70">{alert.title || 'Alert'}</p>
      <p className="text-sm font-semibold">{alert.message}</p>
    </div>
  );
}
