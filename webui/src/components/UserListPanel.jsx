import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import NicknameForm from './NicknameForm.jsx';
import SocialButtonsGrid from './SocialButtonsGrid.jsx';
import { roverBadgeStyle, roverNameStyle } from '../lib/roverColor.js';

export function NicknameEntryPanel({ compact = false }) {
  return (
    <section className="panel-section flex h-full min-h-0 flex-col gap-0.5 text-base">
      <div className="surface flex w-full items-center px-0 py-0">
        <NicknameForm compact={compact} />
      </div>
    </section>
  );
}

export function LinkButtonsPanel() {
  return (
    <section className="panel-section flex h-full min-h-0 flex-col gap-0.5 text-base">
      <SocialButtonsGrid className="flex-1 min-h-0" />
    </section>
  );
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

export default function UserListPanel({
  hideNicknameForm = false,
  hideHeader = false,
  className = '',
  fillHeight = false,
  compact = false,
  showBothTurnsAndUsers = false,
}) {
  const { session } = useSession();
  const canSetNickname = session?.role !== 'spectator';
  const users = session?.users ?? [];
  const selfId = session?.socketId || null;
  const isTurnsMode = session?.mode === 'turns';
  const turnQueues = session?.turnQueues || {};
  const roster = session?.roster || [];
  const [turnView, setTurnView] = useState('queues');

  useEffect(() => {
    if (!isTurnsMode) return;
    setTurnView('queues');
  }, [isTurnsMode]);

  const sorted = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.socketId === selfId) return -1;
        if (b.socketId === selfId) return 1;
        return (a.nickname || '').localeCompare(b.nickname || '');
      }),
    [selfId, users],
  );

  const rosterEntry = useCallback(
    (roverId) => roster.find((r) => String(r.id) === String(roverId)) || null,
    [roster],
  );

  const lookupUser = useCallback(
    (socketId) => users.find((u) => u.socketId === socketId) || { socketId, nickname: null, role: null },
    [users],
  );

  const secondsRemaining = useCallback((deadline) => {
    if (!deadline) return null;
    const ms = deadline - Date.now();
    if (ms <= 0) return 0;
    return Math.ceil(ms / 1000);
  }, []);

  const baseListClass = fillHeight
    ? 'flex-1 min-h-0 overflow-y-auto'
    : compact
      ? 'h-28 overflow-y-auto'
      : 'h-48 overflow-y-auto';
  const turnsListClass =
    isTurnsMode && fillHeight
      ? 'max-h-40 overflow-y-auto'
      : isTurnsMode && compact
        ? 'max-h-32 overflow-y-auto'
        : baseListClass;
  const usersListClass =
    isTurnsMode && fillHeight ? 'flex-1 min-h-0 overflow-y-auto' : baseListClass;
  const showToggle = isTurnsMode && !showBothTurnsAndUsers;
  const showQueuesSection = isTurnsMode && (showBothTurnsAndUsers || turnView === 'queues');
  const showUsersSection = !isTurnsMode || (showToggle && turnView === 'users');
  const showUsersSecondary = isTurnsMode && showBothTurnsAndUsers;

  const renderUserList = () =>
    sorted.length === 0 ? (
      <p className="text-sm text-slate-500">Waiting for users…</p>
    ) : (
      sorted.map((user) => {
        const isAdmin =
          user.role === 'admin' || user.role === 'lockdown' || user.role === 'lockdown-admin';
        return (
          <div
            key={user.socketId}
            className={`surface-muted flex items-center gap-0.5 ${compact ? 'py-0.25 text-[0.8rem]' : 'text-sm'}`}
          >
            <p className={`font-semibold ${roleColors(user.role)}`}>{formatLabel(user, selfId)}</p>
            {user.roverId ? (
              <span
                className="rounded bg-slate-800 px-1 text-[0.7rem]"
                style={roverBadgeStyle(rosterEntry(user.roverId)?.color, 0.12)}
              >
                rover {rosterEntry(user.roverId)?.name || user.roverId}
              </span>
            ) : (
              <span className="text-[0.7rem] text-slate-500">no rover</span>
            )}
            {isAdmin && (
              <span className="rounded bg-amber-500/30 px-1 text-[0.7rem] text-amber-200">
                Admin
              </span>
            )}
          </div>
        );
      })
    );

  return (
    <section
      className={`panel-section space-y-0.5 text-base ${fillHeight ? 'flex h-full min-h-0 flex-col overflow-hidden' : ''} ${className}`}
    >
      {!hideNicknameForm && (
        <div className="space-y-0.5">
          <div className="grid gap-0.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="surface flex w-full items-center px-0 py-0">
                <NicknameForm compact={compact} />
              </div>
            </div>
            <SocialButtonsGrid />
          </div>
          {!canSetNickname && <p className="text-xs text-slate-500">Spectators cannot set nicknames.</p>}
        </div>
      )}

      <div className={`space-y-0.5 ${fillHeight ? 'flex flex-1 min-h-0 flex-col' : ''}`}>
        {!hideHeader && (
          <div className={`flex items-center justify-between text-sm text-slate-400 ${compact ? 'text-xs' : ''}`}>
            <div className="flex items-center gap-0.5">
              <span>
                {isTurnsMode
                  ? showQueuesSection
                    ? 'Turn queues'
                    : 'Users'
                  : 'Users'}
              </span>
              <span className="text-xs text-slate-500">
                {showQueuesSection && isTurnsMode ? Object.keys(turnQueues || {}).length : sorted.length}
              </span>
            </div>
            {showToggle ? (
              <div className="inline-flex overflow-hidden rounded border border-slate-700 text-[0.7rem]">
                <button
                  type="button"
                  className={`px-1 py-0.5 ${turnView === 'queues' ? 'bg-slate-600 text-white' : 'bg-transparent text-slate-400 hover:text-white'}`}
                  onClick={() => setTurnView('queues')}
                >
                  Queues
                </button>
                <button
                  type="button"
                  className={`px-1 py-0.5 ${turnView === 'users' ? 'bg-slate-600 text-white' : 'bg-transparent text-slate-400 hover:text-white'}`}
                  onClick={() => setTurnView('users')}
                >
                  Users
                </button>
              </div>
            ) : null}
          </div>
        )}
        {showQueuesSection ? (
          <div className={`surface space-y-0.5 px-0 pb-0 ${turnsListClass} ${compact ? 'text-[0.8rem]' : ''}`}>
            {Object.keys(turnQueues || {}).length === 0 ? (
              <p className="text-sm text-slate-500">No turn queues yet.</p>
            ) : (
              Object.entries(turnQueues).map(([roverId, info]) => {
                const queue = info?.queue || [];
                const deadline = info?.idleDeadline || info?.deadline || null;
                const remaining = secondsRemaining(deadline);
                const currentId = info?.current || null;
                const currentIdx = currentId ? queue.findIndex((id) => id === currentId) : -1;
                const nextId =
                  queue.length > 1
                    ? currentIdx >= 0
                      ? queue[(currentIdx + 1) % queue.length]
                      : queue[0]
                    : null;
                return (
                  <div key={roverId} className={`surface-muted flex flex-col gap-0.5 ${compact ? 'text-[0.8rem] py-0.25' : 'text-sm'}`}>
                    <div className="flex items-center gap-0.5">
                      <p className="font-semibold text-slate-200" style={roverNameStyle(rosterEntry(roverId)?.color)}>
                        {rosterEntry(roverId)?.name || roverId}
                      </p>
                      {remaining != null && (
                        <span className="rounded bg-slate-800 px-1 text-[0.7rem]">
                          {remaining}s left
                        </span>
                      )}
                    </div>
                    {queue.length === 0 ? (
                      <p className="text-[0.75rem] text-slate-500">No drivers queued.</p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-0.5">
                        {queue.map((socketId, idx) => {
                          const user = lookupUser(socketId);
                          const isCurrent = socketId === currentId;
                          const isNext = Boolean(nextId && socketId === nextId && !isCurrent);
                          const isSelf = Boolean(selfId && socketId === selfId);
                          const isAdmin =
                            user.role === 'admin' || user.role === 'lockdown' || user.role === 'lockdown-admin';
                          const highlightClass = isCurrent
                            ? 'bg-sky-600 text-white ring-2 ring-amber-300 animate-pulse'
                            : isNext
                            ? 'bg-emerald-700/60 text-emerald-100 ring-1 ring-emerald-300/70'
                            : 'bg-slate-800 text-slate-200';
                          return (
                            <span
                              key={`${roverId}-${socketId}-${idx}`}
                              className={`flex items-center gap-0.5 rounded px-1 ${compact ? 'text-[0.7rem]' : 'text-[0.8rem]'} ${highlightClass}`}
                            >
                              <span className={`${roleColors(user.role)} font-semibold`}>
                                {formatLabel(user, selfId)}
                              </span>
                              {isAdmin && <span className="text-[0.7rem] text-amber-200">★</span>}
                              {/* {isSelf && <span className="text-[0.7rem] text-white">YOU</span>} */}
                              {isCurrent && <span className="text-[0.7rem] text-slate-200">now</span>}
                              {isNext && <span className="text-[0.7rem] text-emerald-100">next</span>}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        {showUsersSection ? (
          <div className={`surface space-y-0.5 px-0 pb-0 ${usersListClass} ${compact ? 'text-[0.8rem]' : ''}`}>
            {renderUserList()}
          </div>
        ) : null}

        {showUsersSecondary ? (
          <div className={`space-y-0.5 ${fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Users</span>
              <span className="text-[0.7rem] text-slate-500">{sorted.length}</span>
            </div>
            <div className={`surface space-y-0.5 px-0 pb-0 ${usersListClass}`}>{renderUserList()}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
