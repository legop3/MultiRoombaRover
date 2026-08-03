// Replay Sources Panel
// Purpose: Defines the Replay Sources Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSharedClock } from '../../hooks/useSharedClock.js';
import { useSettingsNamespace } from '../../settings/index.js';
import CardFrame from '../CardFrame/index.jsx';
import RoverLabel from '../RoverLabel/index.jsx';
import ReplayReadyPopup from './ReplayReadyPopup.jsx';

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

function selectedKeysEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;

  for (let idx = 0; idx < left.length; idx += 1) {
    if (left[idx] !== right[idx]) return false;
  }

  return true;
}

export default function ReplaySourcesPanel({
  panelId = 'replay-sources',
  fillHeight = false,
  defaultSelectedKey = null,
}) {
  const replaySources = useSessionSelector((state) => state.session?.replaySources ?? []);
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const assignmentRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const replayState = useSessionSelector((state) => state.session?.replay || null);
  const replayStatus = useSessionSelector((state) => state.replayStatus);
  const socket = useSocket();
  const { triggerReplay } = useSessionActions();
  const sources = useMemo(() => normalizeSources(replaySources || []), [replaySources]);
  const { value: settings, save: saveSettings } = useSettingsNamespace('replaySources', {});
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');
  const [titleDirty, setTitleDirty] = useState(false);
  const [includeSidebar, setIncludeSidebar] = useState(true);
  const [panelReplay, setPanelReplay] = useState(null);
  // Settings keys include the panel id because the same replay source control is
  // mounted in desktop, portrait, and landscape layouts with independent saved UI
  // preferences. Pulling the values into named constants also gives hook
  // dependencies primitive values instead of hard-to-analyze computed expressions.
  const includeSidebarSettingKey = `${panelId}:includeSidebar`;
  const titleSettingKey = `${panelId}:title`;
  const savedIncludeSidebar = settings?.[includeSidebarSettingKey];
  const savedTitle = settings?.[titleSettingKey];
  const showPanelReplay = Boolean(panelReplay?.url);

  useEffect(() => {
    const handleReplayReady = (replay = {}) => {
      if (!replay?.url) return;
      /*
        A replay popup is an event owned by the lifetime of this mounted panel,
        not retained application history. Listening to the live socket event
        means a ready replay opens immediately, while switching tabs away and
        back cannot replay an event that happened before the new mount.
      */
      setPanelReplay(replay);
    };

    socket.on('replay:ready', handleReplayReady);
    return () => socket.off('replay:ready', handleReplayReady);
  }, [socket]);

  const availableDefaultKey = useMemo(() => {
    // PTZ layouts provide their camera key explicitly so entering the dedicated
    // camera page does not inherit the user's assigned rover. Waiting until the
    // source is actually advertised also handles the initial session load: an
    // unavailable key is never left selected, but it becomes the default as
    // soon as the server publishes that replay source.
    if (defaultSelectedKey && sources.some((source) => source.key === defaultSelectedKey)) {
      return defaultSelectedKey;
    }
    const roverKey = assignmentRoverId ? `rover:${assignmentRoverId}` : null;
    if (roverKey && sources.some((source) => source.key === roverKey)) {
      return roverKey;
    }
    return null;
  }, [assignmentRoverId, defaultSelectedKey, sources]);
  const defaults = useMemo(() => (availableDefaultKey ? [availableDefaultKey] : []), [availableDefaultKey]);

  const defaultTitle = useMemo(() => {
    const roverId = assignmentRoverId || null;
    const roverName =
      roverId && Array.isArray(roster)
        ? roster.find((entry) => String(entry?.id) === String(roverId))?.name || roverId
        : '';
    return roverName ? `Replay: ${roverName}` : 'Replay';
  }, [assignmentRoverId, roster]);

  useEffect(() => {
    // Assignment changes replace the default selection, but identical defaults
    // should not create a fresh array because that would force all source
    // checkboxes to commit with the same checked values.
    setSelected((prev) => (selectedKeysEqual(prev, defaults) ? prev : defaults));
  }, [defaults]);

  useEffect(() => {
    if (typeof savedIncludeSidebar === 'boolean') {
      setIncludeSidebar(savedIncludeSidebar);
      return;
    }
    setIncludeSidebar(true);
  }, [savedIncludeSidebar]);

  useEffect(() => {
    if (typeof savedTitle === 'string') {
      setTitle(savedTitle);
      setTitleDirty(true);
      return;
    }
    setTitleDirty(false);
  }, [savedTitle]);

  useEffect(() => {
    if (!titleDirty) {
      setTitle(defaultTitle);
    }
  }, [defaultTitle, titleDirty]);

  useEffect(() => {
    const allowed = new Set(sources.map((source) => source.key));
    setSelected((prev) => {
      const next = prev.filter((key) => allowed.has(key));

      // Pruning is only meaningful when a selected source disappeared. Returning
      // the existing array for the common no-op path stops this effect from
      // scheduling a render after every parent/session render.
      return selectedKeysEqual(prev, next) ? prev : next;
    });
  }, [sources]);

  const grouped = useMemo(() => {
    return {
      rovers: sources.filter((source) => source.type === 'rover'),
      // PTZ is presented with room cameras because there is only one fixed room
      // PTZ camera and it should not create a separate source category.
      rooms: sources.filter((source) => source.type === 'room' || source.type === 'ptz'),
    };
  }, [sources]);

  const hasReplayCooldown = Boolean(replayState?.lastTriggeredAt && replayState?.cooldownMs);
  const replayCooldownEndsAt = hasReplayCooldown
    ? replayState.lastTriggeredAt + replayState.cooldownMs
    : 0;
  const cooldownNow = useSharedClock(1000, hasReplayCooldown);
  const remainingMs = useMemo(() => {
    if (!hasReplayCooldown) return 0;
    /*
      The button only shows whole seconds, so a shared one-second clock gives the
      same useful information without each mounted replay panel owning a 250ms
      interval. The exact server cooldown still decides whether the action is
      accepted; this value is only the local disabled-state/display estimate.
    */
    const next = replayCooldownEndsAt - cooldownNow;
    return Math.max(0, next);
  }, [cooldownNow, hasReplayCooldown, replayCooldownEndsAt]);

  const replayDisabled = busy || mode === 'lockdown' || remainingMs > 0 || !selected.length;
  const selectedSet = useMemo(() => {
    // Checkbox rendering asks the same membership question for every source.
    // A Set avoids repeated linear scans and, more importantly, gives memoized
    // child lists a stable value while the selected keys have not changed.
    return new Set(selected);
  }, [selected]);
  const replayStatusText = useMemo(() => {
    if (!replayStatus?.status) return null;
    const titleText = replayStatus.title ? `: ${replayStatus.title}` : '';
    switch (replayStatus.status) {
      case 'accepted':
        return `Replay accepted${titleText}`;
      case 'building':
        return `Replay building${titleText}`;
      case 'uploading':
        return `Replay uploading${titleText}`;
      case 'ready':
        return `Replay ready${titleText}`;
      case 'failed':
        return replayStatus.message || `Replay failed${titleText}`;
      default:
        return replayStatus.message || `Replay ${replayStatus.status}${titleText}`;
    }
  }, [replayStatus]);
  const toggleKey = useCallback((key) => {
    setSelected((prev) => {
      return prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key];
    });
  }, []);

  const handleReplay = useCallback(async () => {
    if (replayDisabled) return;
    setBusy(true);
    setError(null);
    try {
      const payload = selected.map((key) => {
        const [type, id] = key.split(':');
        return { type, id };
      });
      const resolvedTitle = String(title || '').trim() || defaultTitle;
      await triggerReplay({ sources: payload, title: resolvedTitle, includeSidebar });
      /*
        Do not set panel-local success state after acknowledgement. The server
        broadcasts the authoritative accepted/building/uploading/ready stages,
        and every replay panel renders that one shared status progression.
      */
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [defaultTitle, includeSidebar, replayDisabled, selected, title, triggerReplay]);

  const listWrapClass = fillHeight ? 'flex-1 min-h-0 overflow-y-auto' : '';

  return (
    <div className={`relative ${fillHeight ? 'flex h-full min-h-0 flex-col' : ''}`}>
      {showPanelReplay ? (
        <div className="absolute bottom-[calc(100%+0.125rem)] left-1/2 z-[70] w-[min(20rem,calc(100vw-1rem))] -translate-x-1/2">
          <ReplayReadyPopup
            replay={panelReplay}
            variant="floating-panel"
            onClose={() => setPanelReplay(null)}
          />
        </div>
      ) : null}
      <CardFrame title="Replay Sources" fillHeight={fillHeight} bodyClassName="space-y-0.5 text-sm">
        <div className={`grid gap-0.5 md:grid-cols-2 ${listWrapClass}`}>
          <GroupList title="Rovers" items={grouped.rovers} selectedSet={selectedSet} onToggle={toggleKey} />
          <GroupList title="Room Cams" items={grouped.rooms} selectedSet={selectedSet} onToggle={toggleKey} />
        </div>
        <div className="space-y-0.5">
          {error ? <div className="text-xs text-amber-400">{error}</div> : null}
          {replayStatusText ? (
            <div className={`text-xs ${replayStatus?.status === 'failed' ? 'text-amber-400' : 'text-emerald-300'}`}>
              {replayStatusText}
            </div>
          ) : null}
          <div className="flex items-center gap-0.5">
            <label className="surface shrink-0 text-xs" htmlFor={`${panelId}-title`}>
              Replay title:
            </label>
            {/* The label has fixed-width content, while the input owns the remaining row space.
                This keeps the title control compact without making the input compete with
                other controls or wrapping unpredictably on narrow panel layouts. */}
            <input
              id={`${panelId}-title`}
              type="text"
              className="field-input min-w-0 flex-1 text-xs"
              value={title}
              onChange={(event) => {
                const next = event.target.value;
                setTitle(next);
                setTitleDirty(true);
                saveSettings((current) => ({ ...(current || {}), [titleSettingKey]: next }));
              }}
              onKeyDown={(event) => {
                // Enter is the keyboard equivalent of clicking Replay. Ignore
                // composition events so confirming an IME candidate cannot
                // accidentally submit a replay before the title is complete.
                // handleReplay remains the single authority for cooldown,
                // lockdown, busy, and empty-source checks.
                if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return;
                event.preventDefault();
                handleReplay();
              }}
              placeholder={defaultTitle}
              maxLength={120}
            />
          </div>
          <div className="flex items-center gap-0.5">
            <label className="surface flex shrink-0 items-center gap-0.5 text-xs">
              <input
                type="checkbox"
                checked={includeSidebar}
                onChange={(event) => {
                  const next = Boolean(event.target.checked);
                  setIncludeSidebar(next);
                  saveSettings((current) => ({ ...(current || {}), [includeSidebarSettingKey]: next }));
                }}
                className="accent-emerald-400"
              />
              <span>Sidebar</span>
            </label>
            {/* The sidebar toggle is stable-width, so the replay button can expand into the
                rest of the row and preserve the compact two-row control layout. */}
            <button
              type="button"
              className="button-dark min-w-0 flex-1 text-xs disabled:opacity-40"
              onClick={handleReplay}
              disabled={replayDisabled}
            >
              {remainingMs > 0 ? `Replay (${Math.ceil(remainingMs / 1000)}s)` : busy ? 'Replay…' : 'Replay'}
            </button>
          </div>
        </div>
      </CardFrame>
    </div>
  );
}

const GroupList = React.memo(function GroupList({ title, items, selectedSet, onToggle }) {
  if (!items.length) return null;
  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs">{title}</div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <label key={item.key} className="surface flex items-center gap-0.5 text-xs">
            <input
              type="checkbox"
              checked={selectedSet.has(item.key)}
              onChange={() => onToggle(item.key)}
              className="accent-emerald-400"
            />
            {item.type === 'rover' ? (
              <RoverLabel name={item.label} color={item.color} fallback={item.id} className="truncate" />
            ) : (
              <span className="truncate">{item.label}</span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
});
