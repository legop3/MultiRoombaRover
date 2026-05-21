// Rover Queues Panel
// Purpose: Defines the Rover Queues Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { roverNameChromeStyle } from '../../lib/roverColor.js';
import CardFrame from '../CardFrame/index.jsx';

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
    case 'lockdown-admin':
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

export default function RoverQueuesPanel({ title = 'Rovers' }) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const turnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const users = useSessionSelector((state) => state.session?.users ?? []);
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const { requestControl } = useSessionActions();
  const [pending, setPending] = useState({});
  const [now, setNow] = useState(() => Date.now());

  const canRequest = useMemo(() => role && role !== 'spectator', [role]);
  const adminCapable = useMemo(
    () => role === 'admin' || role === 'lockdown' || role === 'lockdown-admin',
    [role],
  );
  const hasDeadlines = useMemo(
    () => Object.values(turnQueues || {}).some((info) => info?.deadline || info?.idleDeadline),
    [turnQueues],
  );

  useEffect(() => {
    if (!hasDeadlines) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [hasDeadlines]);

  const rosterItems = useMemo(() => {
    const known = new Set(roster.map((rover) => String(rover.id)));
    const extra = Object.keys(turnQueues || {})
      .filter((id) => !known.has(String(id)))
      .map((id) => ({ id, name: id, locked: false, batteryState: null }));
    return [...roster, ...extra];
  }, [roster, turnQueues]);

  async function handleRequest(targetRoverId) {
    if (!targetRoverId) return;
    setPending((prev) => ({ ...prev, [targetRoverId]: true }));
    try {
      await requestControl(targetRoverId);
    } catch (err) {
      alert(err.message);
    } finally {
      setPending((prev) => ({ ...prev, [targetRoverId]: false }));
    }
  }

  const lookupUser = (socketId) =>
    users.find((u) => u.socketId === socketId) || { socketId, nickname: null, role: null };

  return (
    <CardFrame title={title} accent="#f59e0b" bodyClassName="space-y-0.5 text-sm">
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
            const locked = Boolean(rover.locked);
            const lockedBlocked = locked && !adminCapable;
            const isPrivateOpen = Boolean(rover?.private?.enabled && rover?.private?.open);
            const lockLabel = rover.lockReason ? `locked: ${rover.lockReason}` : 'locked';
            const buttonLabel = locked ? lockLabel : pending[roverId] ? '...' : 'request';
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
                        <span className="rounded px-1 py-[1px] border border-transparent" style={roverNameChromeStyle(rover.color, 0.16)}>
                          {rover.name}
                        </span>
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
    </CardFrame>
  );
}
