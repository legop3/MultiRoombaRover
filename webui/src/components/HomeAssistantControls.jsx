import { useMemo } from 'react';
import { useSession } from '../context/SessionContext.jsx';

function StatusBadge({ label, tone = 'muted' }) {
  const styles =
    tone === 'success'
      ? 'bg-emerald-900 text-emerald-100'
      : tone === 'warn'
      ? 'bg-amber-900 text-amber-100'
      : 'bg-slate-800 text-slate-200';
  return (
    <span className={`rounded px-1 py-0.5 text-xs font-semibold leading-tight ${styles}`}>
      {label}
    </span>
  );
}

function EntityRow({ entity, connected, onToggle }) {
  const unavailable = entity.state === 'unavailable' || !entity.available;
  const isOn = entity.state === 'on';
  const statusTone = unavailable ? 'warn' : isOn ? 'success' : 'muted';
  const statusLabel = unavailable ? 'Unavailable' : isOn ? 'On' : 'Off';
  const disableToggle = !connected || unavailable;
  const toneStyles = unavailable
    ? 'border-slate-800 bg-slate-900 text-slate-400 cursor-not-allowed'
    : isOn
    ? 'border-emerald-700 bg-emerald-900/80 text-emerald-50 hover:bg-emerald-800'
    : 'border-rose-800 bg-rose-900/80 text-rose-50 hover:bg-rose-800';

  return (
    <button
      type="button"
      onClick={() => onToggle(entity.id)}
      disabled={disableToggle}
      className={`flex min-w-[12rem] flex-1 items-center justify-between gap-1 rounded px-1 py-0.5 text-left transition-colors ${toneStyles} disabled:opacity-60 disabled:hover:bg-inherit`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-sm">
          <span className="truncate font-semibold text-white">{entity.name || entity.id}</span>
          <StatusBadge label={entity.type === 'light' ? 'Light' : 'Switch'} />
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <StatusBadge label={statusLabel} tone={statusTone} />
          {!connected && <span className="text-amber-200"> · Offline</span>}
        </div>
      </div>
      <div className="text-xs font-semibold text-white/90">{isOn ? 'Turn off' : 'Turn on'}</div>
    </button>
  );
}

export default function HomeAssistantControls() {
  const { session, homeAssistantToggle } = useSession();
  const ha = session?.homeAssistant;
  const entities = useMemo(() => ha?.entities || [], [ha?.entities]);

  if (!ha?.enabled) {
    return (
      <section className="panel-section space-y-0.5 text-sm text-slate-400">
        <p className="text-slate-300">Light Controls</p>
        <p className="text-slate-500">Not configured on the server.</p>
      </section>
    );
  }

  if (entities.length === 0) {
    return (
      <section className="panel-section space-y-0.5 text-sm text-slate-400">
        <p className="text-slate-300">Light Controls</p>
        <p className="text-slate-500">No lights or switches configured.</p>
      </section>
    );
  }

  const connected = Boolean(ha?.connected);

  return (
    <section className="panel-section space-y-0.5 text-base">
      <header className="flex items-center justify-between gap-0.5 text-sm text-slate-400">
        <div className="flex items-center gap-1">
          <p>Light Controls</p>
          <span className="text-xs text-slate-500">{entities.length}</span>
        </div>
        <StatusBadge label={connected ? 'Connected' : 'Offline'} tone={connected ? 'success' : 'warn'} />
      </header>
      <div className="flex flex-wrap gap-0.5">
        {entities.map((entity) => (
          <EntityRow
            key={entity.id}
            entity={entity}
            connected={connected}
            onToggle={homeAssistantToggle}
          />
        ))}
      </div>
    </section>
  );
}
