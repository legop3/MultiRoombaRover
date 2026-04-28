import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { roverNameChromeStyle } from '../../lib/roverColor.js';

function normalizeSources(list = []) {
  return list
    .map((entry) => {
      if (!entry?.type || !entry?.id) return null;
      return {
        type: entry.type,
        id: String(entry.id),
        label: entry.label || String(entry.id),
        color: entry.color || null,
        key: `${entry.type}:${entry.id}`,
      };
    })
    .filter(Boolean);
}

export default function ReplaySourcesPanel({ panelId = 'replay-sources', fillHeight = false }) {
  const { session, triggerReplay } = useSession();
  const sources = normalizeSources(session?.replaySources || []);
  const { value: settings, save: saveSettings } = useSettingsNamespace('replaySources', {});
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [title, setTitle] = useState('');
  const [titleDirty, setTitleDirty] = useState(false);
  const [includeSidebar, setIncludeSidebar] = useState(true);
  const replayState = session?.replay || null;
  const [remainingMs, setRemainingMs] = useState(0);

  const defaults = useMemo(() => {
    const roverId = session?.assignment?.roverId;
    if (roverId) {
      return [`rover:${roverId}`];
    }
    return [];
  }, [session?.assignment?.roverId]);

  const defaultTitle = useMemo(() => {
    const self = Array.isArray(session?.users)
      ? session.users.find((entry) => entry?.socketId === session?.socketId)
      : null;
    const nickname = (self?.nickname || 'Someone').trim() || 'Someone';
    const roverId = session?.assignment?.roverId || null;
    const roverName =
      roverId && Array.isArray(session?.roster)
        ? session.roster.find((entry) => String(entry?.id) === String(roverId))?.name || roverId
        : 'a rover';
    return `${nickname} driving ${roverName}`;
  }, [session?.users, session?.socketId, session?.assignment?.roverId, session?.roster]);

  useEffect(() => {
    const saved = settings?.[panelId];
    if (Array.isArray(saved) && saved.length) {
      setSelected(saved);
      return;
    }
    setSelected(defaults);
  }, [settings?.[panelId], defaults, panelId]);

  useEffect(() => {
    const saved = settings?.[`${panelId}:includeSidebar`];
    if (typeof saved === 'boolean') {
      setIncludeSidebar(saved);
      return;
    }
    setIncludeSidebar(true);
  }, [settings?.[`${panelId}:includeSidebar`], panelId]);

  useEffect(() => {
    if (!titleDirty) {
      setTitle(defaultTitle);
    }
  }, [defaultTitle, titleDirty]);

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
    setSuccess(null);
  };

  const handleReplay = async () => {
    if (replayDisabled) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = selected.map((key) => {
        const [type, id] = key.split(':');
        return { type, id };
      });
      const resolvedTitle = String(title || '').trim() || defaultTitle;
      await triggerReplay({ sources: payload, title: resolvedTitle, includeSidebar });
      setSuccess('Replay sent. Check the Discord replay channel.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const containerClass = fillHeight ? 'h-full flex flex-col' : '';
  const listWrapClass = fillHeight ? 'flex-1 min-h-0 overflow-y-auto' : '';

  return (
    <section className={`panel-section p-0.75 text-sm ${containerClass}`}>
      <header className="panel-muted flex items-center justify-between text-xs">
        <span>Replay Sources</span>
        <span>{sources.length}</span>
      </header>
      <div className={`grid gap-0.5 md:grid-cols-2 ${listWrapClass}`}>
        <GroupList title="Rovers" items={grouped.rovers} selected={selected} onToggle={toggleKey} />
        <GroupList title="Room Cams" items={grouped.rooms} selected={selected} onToggle={toggleKey} />
      </div>
      <div className="space-y-0.5">
        <label className="panel-muted block text-xs" htmlFor={`${panelId}-title`}>
          Replay title
        </label>
        <input
          id={`${panelId}-title`}
          type="text"
          className="field-input w-full text-xs"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleDirty(true);
          }}
          placeholder={defaultTitle}
          maxLength={120}
        />
        <label className="surface flex items-center gap-0.5 text-xs">
          <input
            type="checkbox"
            checked={includeSidebar}
            onChange={(event) => {
              const next = Boolean(event.target.checked);
              setIncludeSidebar(next);
              saveSettings((current) => ({ ...(current || {}), [`${panelId}:includeSidebar`]: next }));
            }}
            className="accent-emerald-400"
          />
          <span>Include replay sidebar</span>
        </label>
        <button
          type="button"
          className="button-dark w-full text-xs disabled:opacity-40"
          onClick={handleReplay}
          disabled={replayDisabled}
        >
          {remainingMs > 0 ? `Replay (${Math.ceil(remainingMs / 1000)}s)` : busy ? 'Replay…' : 'Replay'}
        </button>
        {error ? <div className="text-xs text-amber-400">{error}</div> : null}
        {success ? <div className="text-xs text-emerald-300">{success}</div> : null}
      </div>
    </section>
  );
}

function GroupList({ title, items, selected, onToggle }) {
  if (!items.length) return null;
  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs">{title}</div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <label key={item.key} className="surface flex items-center gap-0.5 text-xs">
            <input
              type="checkbox"
              checked={selected.includes(item.key)}
              onChange={() => onToggle(item.key)}
              className="accent-emerald-400"
            />
            <span
              className={`truncate ${item.type === 'rover' ? 'rounded px-1 py-[1px] border border-transparent' : ''}`}
              style={item.type === 'rover' ? roverNameChromeStyle(item.color, 0.16) : undefined}
            >
              {item.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
