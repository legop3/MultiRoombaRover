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

  return (
    <article className="flex items-center justify-between gap-1 rounded border border-slate-800 bg-zinc-950 px-1 py-0.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-sm text-white">
          <span className="truncate font-semibold">{entity.name || entity.id}</span>
          <StatusBadge label={entity.type === 'light' ? 'Light' : 'Switch'} />
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <StatusBadge label={statusLabel} tone={statusTone} />
          {!connected && <span className="text-amber-200"> · Offline</span>}
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="button-dark whitespace-nowrap px-1 py-0.5 text-xs"
          disabled={disableToggle}
          onClick={() => onToggle(entity.id)}
        >
          {isOn ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    </article>
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
          <p>Home Assistant</p>
          <span className="text-xs text-slate-500">{entities.length}</span>
        </div>
        <StatusBadge label={connected ? 'Connected' : 'Offline'} tone={connected ? 'success' : 'warn'} />
      </header>
      <div className="space-y-0.5">
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
