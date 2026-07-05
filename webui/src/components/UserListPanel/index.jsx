// User List Panel
// Purpose: Defines the User List Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import NicknameForm from '../NicknameForm/index.jsx';
import SocialButtonsGrid from '../SocialButtonsGrid/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import RoverLabel from '../RoverLabel/index.jsx';

export function NicknameEntryPanel({ compact = false }) {
  return (
    <CardFrame hideHeader className="h-full" bodyClassName="flex h-full min-h-0 flex-col gap-0.5 text-base">
      <div className="flex w-full items-center px-0 py-0">
        <NicknameForm compact={compact} />
      </div>
    </CardFrame>
  );
}

export function LinkButtonsPanel({ className = '' }) {
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'socials'));

  /*
    This component is the actual Links panel shell. SocialButtonsGrid already
    hides the buttons when socials are disabled, but the shell must also hide
    itself so the UI does not leave an empty "Links!" card behind.
  */
  if (!enabled) return null;

  return (
    <CardFrame
      title="Links!"
      fillHeight
      className={className}
      bodyClassName="flex flex-1 min-h-0 flex-col gap-0.5 text-base"
    >
      <SocialButtonsGrid className="flex-1 min-h-0" />
    </CardFrame>
  );
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

export default function UserListPanel({
  hideNicknameForm = false,
  hideHeader = false,
  className = '',
  fillHeight = false,
  compact = false,
  showBothTurnsAndUsers = false,
}) {
  const users = useSessionSelector((state) => state.session?.users ?? []);
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const turnQueues = useSessionSelector((state) => state.session?.turnQueues || {});
  const roster = useSessionSelector((state) => state.session?.roster || []);
  const isTurnsMode = mode === 'turns';
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
          user.role === 'admin' || user.role === 'lockdown';
        return (
          <div
            key={user.socketId}
            className={`flex items-center gap-0.5 ${compact ? 'py-0.25 text-[0.8rem]' : 'text-sm'}`}
          >
            <p className={`font-semibold ${roleColors(user.role)}`}>{formatLabel(user, selfId)}</p>
            {user.roverId ? (
              <RoverLabel
                roverId={user.roverId}
                color={rosterEntry(user.roverId)?.color}
                fallback={user.roverId}
                className="text-[0.7rem]"
              />
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
    <CardFrame
      title={!hideHeader ? (isTurnsMode ? (showQueuesSection ? 'Turn queues' : 'Users') : 'Users') : ''}
      meta={!hideHeader ? (showQueuesSection && isTurnsMode ? Object.keys(turnQueues || {}).length : sorted.length) : null}
      hideHeader={hideHeader}
      fillHeight={fillHeight}
      className={className}
      bodyClassName="space-y-0.5 text-base"
    >
      {!hideNicknameForm && (
        <div className="space-y-0.5">
          <div className="grid gap-0.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="flex w-full items-center px-0 py-0">
                <NicknameForm compact={compact} />
              </div>
            </div>
            <SocialButtonsGrid />
          </div>
        </div>
      )}

      <div className={`space-y-0.5 ${fillHeight ? 'flex flex-1 min-h-0 flex-col' : ''}`}>
        {!hideHeader && showToggle ? (
          <div className="flex justify-end">
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
          </div>
        ) : null}
        {showQueuesSection ? (
          <div className={`space-y-0.5 px-0 pb-0 ${turnsListClass} ${compact ? 'text-[0.8rem]' : ''}`}>
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
                  <div key={roverId} className={`flex flex-col gap-0.5 ${compact ? 'text-[0.8rem] py-0.25' : 'text-sm'}`}>
                    <div className="flex items-center gap-0.5">
                      <p className="font-semibold text-slate-200">
                        <RoverLabel roverId={roverId} fallback={roverId} />
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
                            user.role === 'admin' || user.role === 'lockdown';
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
          <div className={`space-y-0.5 px-0 pb-0 ${usersListClass} ${compact ? 'text-[0.8rem]' : ''}`}>
            {renderUserList()}
          </div>
        ) : null}

        {showUsersSecondary ? (
          <div className={`space-y-0.5 ${fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Users</span>
              <span className="text-[0.7rem] text-slate-500">{sorted.length}</span>
            </div>
            <div className={`space-y-0.5 px-0 pb-0 ${usersListClass}`}>{renderUserList()}</div>
          </div>
        ) : null}
      </div>
    </CardFrame>
  );
}
