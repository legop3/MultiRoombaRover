import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import { useSocket } from '../context/SocketContext.jsx';

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

export default function UserListPanel() {
  const { session, setNickname } = useSession();
  const { value, save } = useSettingsNamespace('profile', { nickname: '' });
  const [nicknameInput, setNicknameInput] = useState(value.nickname || '');
  const [saving, setSaving] = useState(false);
  const lastSyncedSocketRef = useRef(null);
  const socket = useSocket();
  const canSetNickname = session?.role !== 'spectator';
  const users = session?.users ?? [];
  const selfId = session?.socketId || null;
  const isTurnsMode = session?.mode === 'turns';
  const turnQueues = session?.turnQueues || {};
  const roster = session?.roster || [];

  useEffect(() => {
    setNicknameInput(value.nickname || '');
  }, [value.nickname]);

  useEffect(() => {
    if (!canSetNickname) return;
    if (!session?.socketId) return;
    if (!nicknameInput) return;
    if (session.socketId === lastSyncedSocketRef.current) return;
    const currentId = session.socketId;
    setNickname(nicknameInput).then(() => {
      lastSyncedSocketRef.current = currentId;
    }).catch(() => {});
  }, [canSetNickname, nicknameInput, session?.socketId, setNickname]);

  useEffect(() => {
    if (!socket) return undefined;
    const handleConnect = () => {
      if (!canSetNickname) return;
      const nick = (value.nickname || '').trim();
      if (!nick) return;
      setNickname(nick).then(() => {
        lastSyncedSocketRef.current = session?.socketId || null;
      }).catch(() => {});
    };
    socket.on('connect', handleConnect);
    return () => socket.off('connect', handleConnect);
  }, [canSetNickname, setNickname, socket, value.nickname, session?.socketId]);

  const sorted = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.socketId === selfId) return -1;
        if (b.socketId === selfId) return 1;
        return (a.nickname || '').localeCompare(b.nickname || '');
      }),
    [selfId, users],
  );

  const rosterName = useCallback(
    (roverId) => roster.find((r) => String(r.id) === String(roverId))?.name || roverId,
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

  async function handleSave(event) {
    event.preventDefault();
    if (!canSetNickname) return;
    const trimmed = (nicknameInput || '').trim().slice(0, 32);
    if (!trimmed) return;
    setSaving(true);
    try {
      await setNickname(trimmed);
      save({ nickname: trimmed });
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel-section space-y-0.5 text-base">
      <div className="space-y-0.5">
        {/* <p className="text-sm text-slate-400">Nickname</p> */}
        <form className="flex gap-0.5" onSubmit={handleSave}>
          <input
            className="field-input flex-1"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            maxLength={32}
            placeholder="Enter a nickname"
            disabled={!canSetNickname}
          />
          <button type="submit" disabled={!canSetNickname || saving} className="button-dark disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
        {!canSetNickname && <p className="text-xs text-slate-500">Spectators cannot set nicknames.</p>}
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>{isTurnsMode ? 'Turn queues' : 'Users'}</span>
          <span className="text-xs text-slate-500">
            {isTurnsMode ? Object.keys(turnQueues || {}).length : sorted.length}
          </span>
        </div>
        <div className="surface h-48 overflow-y-auto space-y-0.25">
          {isTurnsMode ? (
            Object.keys(turnQueues || {}).length === 0 ? (
              <p className="text-sm text-slate-500">No turn queues yet.</p>
            ) : (
              Object.entries(turnQueues).map(([roverId, info]) => {
                const queue = info?.queue || [];
                const deadline = info?.deadline || null;
                const remaining = secondsRemaining(deadline);
                return (
                  <div key={roverId} className="surface-muted flex flex-col gap-0.25 text-sm">
                    <div className="flex items-center gap-1">
                      <p className="font-semibold text-slate-200">{rosterName(roverId)}</p>
                      {remaining != null && (
                        <span className="rounded bg-slate-800 px-1 text-[0.7rem]">
                          {remaining}s left
                        </span>
                      )}
                    </div>
                    {queue.length === 0 ? (
                      <p className="text-[0.75rem] text-slate-500">No drivers queued.</p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {queue.map((socketId, idx) => {
                          const user = lookupUser(socketId);
                          const isCurrent = socketId === info?.current;
                          const isAdmin =
                            user.role === 'admin' || user.role === 'lockdown' || user.role === 'lockdown-admin';
                          return (
                            <span
                              key={`${roverId}-${socketId}-${idx}`}
                              className={`flex items-center gap-0.5 rounded px-1 text-[0.8rem] ${
                                isCurrent ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-200'
                              }`}
                            >
                              <span className={`${roleColors(user.role)} font-semibold`}>
                                {formatLabel(user, selfId)}
                              </span>
                              {isAdmin && <span className="text-[0.7rem] text-amber-200">★</span>}
                              {isCurrent && <span className="text-[0.7rem] text-slate-200">now</span>}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : sorted.length === 0 ? (
            <p className="text-sm text-slate-500">Waiting for users…</p>
          ) : (
            sorted.map((user) => {
              const isAdmin =
                user.role === 'admin' || user.role === 'lockdown' || user.role === 'lockdown-admin';
              return (
                <div
                  key={user.socketId}
                  className="surface-muted flex items-center gap-1 text-sm"
                >
                  <p className={`font-semibold ${roleColors(user.role)}`}>{formatLabel(user, selfId)}</p>
                  {user.roverId ? (
                    <span className="rounded bg-slate-800 px-1 text-[0.7rem]">rover {user.roverId}</span>
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
          )}
        </div>
      </div>
    </section>
  );
}
