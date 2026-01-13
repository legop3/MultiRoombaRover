import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';

function normalizeSources(list = []) {
  return list
    .map((entry) => {
      if (!entry?.type || !entry?.id) return null;
      return {
        type: entry.type,
        id: String(entry.id),
        label: entry.label || String(entry.id),
        key: `${entry.type}:${entry.id}`,
      };
    })
    .filter(Boolean);
}

export default function ReplaySourcesPanel({ panelId = 'replay-sources' }) {
  const { session, triggerReplay } = useSession();
  const sources = normalizeSources(session?.replaySources || []);
  const { value: settings, save: saveSettings } = useSettingsNamespace('replaySources', {});
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const replayState = session?.replay || null;
  const [remainingMs, setRemainingMs] = useState(0);

  const defaults = useMemo(() => {
    const roverId = session?.assignment?.roverId;
    if (roverId) {
      return [`rover:${roverId}`];
    }
    return [];
  }, [session?.assignment?.roverId]);

  useEffect(() => {
    const saved = settings?.[panelId];
    if (Array.isArray(saved) && saved.length) {
      setSelected(saved);
      return;
    }
    setSelected(defaults);
  }, [settings?.[panelId], defaults, panelId]);

  useEffect(() => {
    const allowed = new Set(sources.map((source) => source.key));
    setSelected((prev) => prev.filter((key) => allowed.has(key)));
  }, [sources]);

  const grouped = useMemo(() => {
    return {
      rovers: sources.filter((source) => source.type === 'rover'),
      rooms: sources.filter((source) => source.type === 'room'),
    };
  }, [sources]);

  useEffect(() => {
    if (!replayState?.lastTriggeredAt || !replayState?.cooldownMs) {
      setRemainingMs(0);
      return undefined;
    }
    const update = () => {
      const next = replayState.lastTriggeredAt + replayState.cooldownMs - Date.now();
      setRemainingMs(Math.max(0, next));
    };
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [replayState?.lastTriggeredAt, replayState?.cooldownMs, replayState?.remainingMs]);

  const replayDisabled = busy || session?.mode === 'lockdown' || remainingMs > 0 || !selected.length;

  const toggleKey = (key) => {
    setSelected((prev) => {
      const next = prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key];
      saveSettings((current) => ({ ...(current || {}), [panelId]: next }));
      return next;
    });
  };

  const handleReplay = async () => {
    if (replayDisabled) return;
    setBusy(true);
    setError(null);
    try {
      const payload = selected.map((key) => {
        const [type, id] = key.split(':');
        return { type, id };
      });
      await triggerReplay(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel h-full w-full">
      <div className="flex h-full flex-col gap-0.5 p-0.75 text-sm">
        <header className="flex items-center justify-between text-slate-300">
          <span className="text-xs uppercase tracking-wide text-slate-400">Replay Sources</span>
          <span className="text-xs text-slate-500">{sources.length}</span>
        </header>
        <div className="flex-1 overflow-auto pr-0.5">
          <GroupList title="Rovers" items={grouped.rovers} selected={selected} onToggle={toggleKey} />
          <GroupList title="Room Cams" items={grouped.rooms} selected={selected} onToggle={toggleKey} />
        </div>
        <div className="space-y-0.25">
          <button
            type="button"
            className={`w-full rounded border px-1 py-0.5 text-xs ${
              replayDisabled
                ? 'border-slate-700 text-slate-500'
                : 'border-slate-500 text-slate-200 hover:border-slate-300 hover:text-white'
            }`}
            onClick={handleReplay}
            disabled={replayDisabled}
          >
            {remainingMs > 0 ? `Replay (${Math.ceil(remainingMs / 1000)}s)` : busy ? 'Replay…' : 'Replay'}
          </button>
          {error ? <div className="text-xs text-amber-400">{error}</div> : null}
        </div>
      </div>
    </section>
  );
}

function GroupList({ title, items, selected, onToggle }) {
  if (!items.length) return null;
  return (
    <div className="mb-0.5 space-y-0.25">
      <div className="text-xs uppercase text-slate-500">{title}</div>
      <div className="space-y-0.25">
        {items.map((item) => (
          <label key={item.key} className="flex items-center gap-0.5 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={selected.includes(item.key)}
              onChange={() => onToggle(item.key)}
              className="accent-emerald-400"
            />
            <span className="truncate">{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
