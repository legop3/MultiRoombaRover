import { useMemo } from 'react';
import { useSession } from '../context/SessionContext.jsx';

function AlertCard({ alert }) {
  const color =
    alert.color === 'error'
      ? 'bg-red-500/10 border-red-500/40 text-red-100'
      : alert.color === 'warn'
      ? 'bg-amber-500/10 border-amber-500/40 text-amber-100'
      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100';

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${color}`}>
      <p className="text-xs uppercase tracking-[0.3em] opacity-60">{alert.title || 'Alert'}</p>
      <p className="mt-1 text-base font-semibold">{alert.message}</p>
    </div>
  );
}

export default function AlertFeed() {
  const { alerts } = useSession();
  const recent = useMemo(() => alerts.slice(-5).reverse(), [alerts]);
  if (recent.length === 0) return null;
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-lg font-semibold text-white">Recent Alerts</h2>
      <div className="mt-4 space-y-3">{recent.map((alert) => <AlertCard key={alert.id || alert.message} alert={alert} />)}</div>
    </section>
  );
}
