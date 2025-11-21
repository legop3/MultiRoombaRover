import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';

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
  const hasSyncedRef = useRef(false);
  const canSetNickname = session?.role !== 'spectator';
  const users = session?.users ?? [];
  const selfId = session?.socketId || null;

  useEffect(() => {
    setNicknameInput(value.nickname || '');
  }, [value.nickname]);

  useEffect(() => {
    if (hasSyncedRef.current) return;
    if (!canSetNickname) return;
    if (!session?.socketId) return;
    if (!nicknameInput) return;
    hasSyncedRef.current = true;
    setNickname(nicknameInput).catch(() => {
      hasSyncedRef.current = false;
    });
  }, [canSetNickname, nicknameInput, session?.socketId, setNickname]);

  const sorted = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.socketId === selfId) return -1;
        if (b.socketId === selfId) return 1;
        return (a.nickname || '').localeCompare(b.nickname || '');
      }),
    [selfId, users],
  );

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
          <span>Users</span>
          <span className="text-xs text-slate-500">{sorted.length}</span>
        </div>
        <div className="surface h-48 overflow-y-auto space-y-0.5">
          {sorted.length === 0 ? (
            <p className="text-sm text-slate-500">Waiting for users…</p>
          ) : (
            sorted.map((user) => {
              const isAdmin =
                user.role === 'admin' || user.role === 'lockdown' || user.role === 'lockdown-admin';
              return (
                <div
                  key={user.socketId}
                  className="surface-muted flex items-center justify-between gap-0.5 text-sm"
                >
                  <div>
                    <p className={`font-semibold ${roleColors(user.role)}`}>{formatLabel(user, selfId)}</p>
                    <p className="text-[0.7rem] text-slate-400">
                      {user.roverId ? `Driving ${user.roverId}` : 'No rover'}
                    </p>
                  </div>
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
