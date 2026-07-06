// Rover Queues Panel
// Purpose: Defines the Rover Queues Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSharedClock } from '../../hooks/useSharedClock.js';
import CardFrame from '../CardFrame/index.jsx';
import RoverLabel from '../RoverLabel/index.jsx';
import { trackAnalyticsEvent } from '../../analytics/index.js';
import { openExternalRoverWithPrompt } from '../../lib/interInstanceTransfer.js';
import { ExternalInstancesCompact } from '../InterInstancePanel/index.jsx';
import { isFeatureEnabled } from '../../lib/features.js';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function formatBattery(rover) {
  const percent = rover?.batteryState?.percentDisplay;
  if (percent == null) return '--';
  return `${percent}%`;
}

function batteryClass(rover) {
  if (!rover?.batteryState) return 'text-slate-400';
  if (rover.batteryState.urgentActive) return 'text-red-400';
  if (rover.batteryState.warnActive) return 'text-amber-300';
  return 'text-emerald-300';
}

function roleColors(role) {
  switch (role) {
    case 'admin':
    case 'lockdown':
      return 'text-amber-300';
    case 'spectator':
      return 'text-slate-400';
    default:
      return 'text-sky-300';
  }
}

function formatLabel(user, selfId) {
  if (!user) return '';
  const base = user.nickname || user.socketId?.slice(0, 6) || 'unknown';
  if (user.socketId && user.socketId === selfId) {
    return `${base} (you)`;
  }
  return base;
}

export default function RoverQueuesPanel({
  title = 'Rovers',
  roster: rosterOverride = null,
  turnQueues: turnQueuesOverride = null,
  users: usersOverride = null,
  externalInstance = null,
}) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const localRoster = useSessionSelector((state) => state.session?.roster ?? []);
  const localTurnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const localUsers = useSessionSelector((state) => state.session?.users ?? []);
  const interInstanceEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'interInstance'));
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const assignedRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());
  const assignedRoverName = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    if (!roverId) return '';
    const rover = (state.session?.roster || []).find((entry) => String(entry?.id) === roverId);
    return rover?.name || roverId;
  });
  const { requestControl, rebootOwnRover } = useSessionActions();
  const [pending, setPending] = useState({});
  const [rebootPending, setRebootPending] = useState(false);
  const externalMode = Boolean(externalInstance);
  const roster = Array.isArray(rosterOverride) ? rosterOverride : localRoster;
  const turnQueues = turnQueuesOverride && typeof turnQueuesOverride === 'object' ? turnQueuesOverride : localTurnQueues;
  const users = Array.isArray(usersOverride) ? usersOverride : localUsers;

  const canRequest = useMemo(() => externalMode || (role && role !== 'spectator'), [externalMode, role]);
  const adminCapable = useMemo(
    () => role === 'admin' || role === 'lockdown',
    [role],
  );
  const hasDeadlines = useMemo(
    () => Object.values(turnQueues || {}).some((info) => info?.deadline || info?.idleDeadline),
    [turnQueues],
  );
  /*
    Queue timers are shown in whole seconds, and several queue panels can be
    mounted across desktop/mobile/spectator layouts. Sharing the one-second
    clock keeps those labels in sync while using a single interval globally.
  */
  const now = useSharedClock(1000, hasDeadlines);

  const rosterItems = useMemo(() => {
    const known = new Set(roster.map((rover) => String(rover.id)));
    const extra = Object.keys(turnQueues || {})
      .filter((id) => !known.has(String(id)))
      .map((id) => ({ id, name: id, locked: false, batteryState: null }));
    return [...roster, ...extra];
  }, [roster, turnQueues]);

  async function handleRequest(targetRoverId) {
    if (!targetRoverId) return;
    if (externalMode) {
      /*
        External queue cards deliberately reuse the local row layout, but their
        action cannot go through this Socket.IO server. The row opens the remote
        instance, optionally carrying settings after the source-page prompt.
      */
      openExternalRoverWithPrompt(externalInstance, targetRoverId);
      return;
    }
    setPending((prev) => ({ ...prev, [targetRoverId]: true }));
    trackAnalyticsEvent('rover_queue_join', {
      roverId: targetRoverId,
      alreadyAssigned: assignedRoverId === String(targetRoverId),
    });
    try {
      await requestControl(targetRoverId);
      trackAnalyticsEvent('rover_queue_join_result', {
        roverId: targetRoverId,
        status: 'accepted',
      });
    } catch (err) {
      trackAnalyticsEvent('rover_queue_join_result', {
        roverId: targetRoverId,
        status: 'failed',
        reason: err?.message || 'unknown',
      });
      alert(err.message);
    } finally {
      setPending((prev) => ({ ...prev, [targetRoverId]: false }));
    }
  }

  const lookupUser = (socketId) =>
    users.find((u) => u.socketId === socketId) || { socketId, nickname: null, role: null };

  async function handleRebootOwnRover() {
    if (rebootPending) return;
    const ok = window.confirm(`Reboot your rover "${assignedRoverName}" now?`);
    if (!ok) return;
    setRebootPending(true);
    trackAnalyticsEvent('rover_reboot_click', { roverId: assignedRoverId, scope: 'own_rover' });
    try {
      await rebootOwnRover();
      trackAnalyticsEvent('rover_reboot_result', { roverId: assignedRoverId, scope: 'own_rover', status: 'accepted' });
      alert('Reboot command sent.');
    } catch (err) {
      trackAnalyticsEvent('rover_reboot_result', {
        roverId: assignedRoverId,
        scope: 'own_rover',
        status: 'failed',
        reason: err?.message || 'unknown',
      });
      alert(err.message);
    } finally {
      setRebootPending(false);
    }
  }

  const headerActions =
    !externalMode && role !== 'spectator' && assignedRoverId ? (
      <button
        type="button"
        onClick={handleRebootOwnRover}
        disabled={rebootPending}
        className="button-dark bg-amber-700/80 text-amber-50 hover:bg-amber-600 disabled:opacity-40"
        title="Reboot your assigned rover"
      >
        {rebootPending ? 'Rebooting...' : 'Reboot My Rover'}
      </button>
    ) : null;

  return (
    <CardFrame title={title} actions={headerActions} bodyClassName="space-y-0.5 text-sm">
      <div className="space-y-0.5">
        {rosterItems.length === 0 ? (
          <p className="text-sm text-slate-500">No rovers registered.</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {rosterItems.map((rover) => {
            const roverId = String(rover.id);
            const info = turnQueues?.[roverId] || null;
            const queue = info?.queue || [];
            const deadline = info?.idleDeadline || info?.deadline || null;
            const remainingSeconds =
              deadline && deadline > now ? Math.ceil((deadline - now) / 1000) : deadline ? 0 : null;
            const currentId = info?.current || null;
            const currentIdx = currentId ? queue.findIndex((id) => id === currentId) : -1;
            const nextId =
              queue.length > 1
                ? currentIdx >= 0
                  ? queue[(currentIdx + 1) % queue.length]
                  : queue[0]
                : null;
            const isSelfCurrent = Boolean(selfId && currentId && currentId === selfId);
            const isSelfNext = Boolean(selfId && nextId && nextId === selfId);
            const showTimer = remainingSeconds != null && (isSelfCurrent || isSelfNext);
            const isPrivateOpen = Boolean(rover?.private?.enabled && rover?.private?.open);
            const isGrantedClosedPrivate = Boolean(rover?.private?.enabled && !rover?.private?.open);
            const locked = Boolean(rover.locked);
            const lockedBlocked = !externalMode && locked && !adminCapable && !isGrantedClosedPrivate;
            const lockLabel = rover.lockReason ? `locked: ${rover.lockReason}` : 'locked';
            const buttonLabel = pending[roverId]
              ? '...'
              : externalMode
              ? 'Open'
              : locked && !isGrantedClosedPrivate
              ? lockLabel
              : 'request';
            const canClickRow = canRequest && !lockedBlocked && !pending[roverId];
            return (
              <li
                key={rover.id}
                className={classNames(
                  'surface flex flex-wrap items-start justify-between gap-0.5',
                  canClickRow && 'cursor-pointer',
                  locked
                    ? 'bg-red-900/40'
                    : isPrivateOpen
                    ? 'bg-amber-700/35 border border-amber-200/30'
                    : null,
                )}
                onClick={() => {
                  if (!canClickRow) return;
                  handleRequest(rover.id);
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-0.5">
                    <div className="flex min-w-0 items-center gap-0.5">
                      <p className="min-w-0 flex items-center gap-0.5 whitespace-nowrap text-slate-200">
                        <RoverLabel rover={rover} fallback={roverId} />
                        {rover.description ? (
                          <span className="min-w-0 flex-1 truncate text-[0.7rem] text-slate-400">
                            {rover.description}
                          </span>
                        ) : null}
                      </p>
                      {showTimer ? (
                        <span className="rounded bg-slate-800 px-1 text-[0.7rem] text-slate-200">
                          {isSelfCurrent ? `${remainingSeconds}s left` : `Your turn in ${remainingSeconds}s`}
                        </span>
                      ) : null}
                    </div>
                    <span className={classNames('text-[0.75rem] font-semibold', batteryClass(rover))}>
                      {formatBattery(rover)}
                    </span>
                  </div>
                  {queue.length === 0 ? (
                    <p className="text-[0.7rem] text-slate-500">No queue.</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-0.5">
                      {queue.map((socketId, idx) => {
                        const user = lookupUser(socketId);
                        const isCurrent = socketId === currentId;
                        const isNext = Boolean(nextId && socketId === nextId && !isCurrent);
                        const highlightClass = isCurrent
                          ? 'bg-sky-600 text-white ring-2 ring-amber-300'
                          : isNext
                          ? 'bg-emerald-700/60 text-emerald-100 ring-1 ring-emerald-300/70'
                          : 'bg-slate-800 text-slate-200';
                        return (
                          <span
                            key={`${roverId}-${socketId}-${idx}`}
                            className={`flex items-center gap-0.5 rounded px-1 text-[0.7rem] ${highlightClass}`}
                          >
                            <span className={`${roleColors(user.role)} font-semibold`}>
                              {formatLabel(user, selfId)}
                            </span>
                            {isCurrent && <span className="text-[0.65rem] text-slate-200">now</span>}
                            {isNext && <span className="text-[0.65rem] text-emerald-100">next</span>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                {canRequest ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRequest(rover.id);
                    }}
                    disabled={pending[roverId] || lockedBlocked}
                    className={classNames(
                      'button-dark disabled:opacity-40',
                      locked && 'bg-red-600/70 text-white hover:bg-red-600',
                    )}
                  >
                    {buttonLabel}
                  </button>
                ) : null}
              </li>
            );
            })}
          </ul>
        )}
        {!externalMode && interInstanceEnabled ? <ExternalInstancesCompact /> : null}
      </div>
    </CardFrame>
  );
}
