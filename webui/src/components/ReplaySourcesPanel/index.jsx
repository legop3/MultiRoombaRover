// Replay Sources Panel
// Purpose: Defines the Replay Sources Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
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

export default function ReplaySourcesPanel({ panelId = 'replay-sources', fillHeight = false }) {
  const replaySources = useSessionSelector((state) => state.session?.replaySources ?? []);
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const assignmentRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const replayState = useSessionSelector((state) => state.session?.replay || null);
  const latestReplay = useSessionSelector((state) => state.latestReplay);
  const { triggerReplay } = useSessionActions();
  const sources = useMemo(() => normalizeSources(replaySources || []), [replaySources]);
  const { value: settings, save: saveSettings } = useSettingsNamespace('replaySources', {});
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [title, setTitle] = useState('');
  const [titleDirty, setTitleDirty] = useState(false);
  const [includeSidebar, setIncludeSidebar] = useState(true);
  const [activeJobId, setActiveJobId] = useState(null);
  const [dismissedPanelReplayId, setDismissedPanelReplayId] = useState(null);
  // Settings keys include the panel id because the same replay source control is
  // mounted in desktop, portrait, and landscape layouts with independent saved UI
  // preferences. Pulling the values into named constants also gives hook
  // dependencies primitive values instead of hard-to-analyze computed expressions.
  const includeSidebarSettingKey = `${panelId}:includeSidebar`;
  const titleSettingKey = `${panelId}:title`;
  const savedIncludeSidebar = settings?.[includeSidebarSettingKey];
  const savedTitle = settings?.[titleSettingKey];
  const activeReplayJob = useSessionSelector((state) => (
    activeJobId ? state.replayJobs?.[activeJobId] || null : null
  ));
  const latestReplayJobId = latestReplay?.jobId || null;
  const showPanelReplay = Boolean(
    latestReplay?.url &&
    latestReplayJobId &&
    dismissedPanelReplayId !== latestReplayJobId,
  );

  const defaults = useMemo(() => {
    const roverId = assignmentRoverId;
    if (roverId) {
      return [`rover:${roverId}`];
    }
    return [];
  }, [assignmentRoverId]);

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
      rooms: sources.filter((source) => source.type === 'room'),
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
  const activeJobStatusText = useMemo(() => {
    if (!activeReplayJob?.status) return null;
    const titleText = activeReplayJob.title ? `: ${activeReplayJob.title}` : '';
    switch (activeReplayJob.status) {
      case 'accepted':
        return `Replay accepted${titleText}`;
      case 'building':
        return `Replay building${titleText}`;
      case 'uploading':
        return `Replay uploading${titleText}`;
      case 'ready':
        return `Replay ready${titleText}`;
      case 'failed':
        return activeReplayJob.message || `Replay failed${titleText}`;
      default:
        return activeReplayJob.message || `Replay ${activeReplayJob.status}${titleText}`;
    }
  }, [activeReplayJob]);

  const toggleKey = useCallback((key) => {
    setSelected((prev) => {
      return prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key];
    });
    setSuccess(null);
  }, []);

  const handleReplay = useCallback(async () => {
    if (replayDisabled) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setActiveJobId(null);
    try {
      const payload = selected.map((key) => {
        const [type, id] = key.split(':');
        return { type, id };
      });
      const resolvedTitle = String(title || '').trim() || defaultTitle;
      const resp = await triggerReplay({ sources: payload, title: resolvedTitle, includeSidebar });
      if (resp?.jobId) {
        // The socket acknowledgement is only the start of the async job.
        // Later replay:status events update this same job id as Discord builds and uploads the video.
        setActiveJobId(resp.jobId);
        setSuccess('Replay accepted.');
      } else {
        setSuccess('Replay accepted.');
      }
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
        <div className="absolute bottom-[calc(100%+0.125rem)] left-1/2 z-[70] w-[min(42rem,calc(100vw-1rem))] -translate-x-1/2">
          <ReplayReadyPopup
            replay={latestReplay}
            variant="floating-panel"
            onClose={() => setDismissedPanelReplayId(latestReplayJobId)}
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
          {activeJobStatusText ? (
            <div className={`text-xs ${activeReplayJob?.status === 'failed' ? 'text-amber-400' : 'text-emerald-300'}`}>
              {activeJobStatusText}
            </div>
          ) : success ? <div className="text-xs text-emerald-300">{success}</div> : null}
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
