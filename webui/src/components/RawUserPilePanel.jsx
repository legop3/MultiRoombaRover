import { useMemo } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import NicknameForm from './NicknameForm.jsx';
import SocialButtonsGrid from './SocialButtonsGrid.jsx';

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

export default function RawUserPilePanel({
  hideNicknameForm = false,
  hideHeader = false,
  className = '',
  fillHeight = false,
  compact = false,
}) {
  const { session } = useSession();
  const canSetNickname = session?.role !== 'spectator';
  const users = session?.users ?? [];
  const selfId = session?.socketId || null;

  const sorted = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.socketId === selfId) return -1;
        if (b.socketId === selfId) return 1;
        return (a.nickname || '').localeCompare(b.nickname || '');
      }),
    [selfId, users],
  );

  const baseListClass = fillHeight
    ? 'flex-1 min-h-0 overflow-y-auto'
    : compact
      ? 'h-28 overflow-y-auto'
      : 'h-48 overflow-y-auto';

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
            <span>Users</span>
            <span className="text-xs text-slate-500">{sorted.length}</span>
          </div>
        )}
        <div
          className={`surface flex flex-wrap content-start items-start gap-0.5 px-0 pb-0 ${baseListClass} ${compact ? 'text-[0.8rem]' : ''}`}
        >
          {sorted.length === 0 ? (
            <p className="text-sm text-slate-500">Waiting for users…</p>
          ) : (
            sorted.map((user) => (
              <span
                key={user.socketId}
                className={`rounded bg-slate-800/80 px-1 py-0.25 text-[0.7rem] ${roleColors(user.role)}`}
              >
                {formatLabel(user, selfId)}
              </span>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
