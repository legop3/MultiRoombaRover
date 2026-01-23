import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import RoverRoster from './RoverRoster.jsx';

const MODES = [
  { key: 'open', label: 'Open' },
  { key: 'turns', label: 'Turns' },
  { key: 'admin', label: 'Admin' },
  { key: 'lockdown', label: 'Lockdown' },
];

export default function AdminPanel() {
  const {
    session,
    lockRover,
    setMode,
    requestControl,
    setCommunityGoal,
    adminLogs,
    moderation,
    banUser,
    timeoutUser,
    unbanUser,
  } = useSession();
  const roster = useMemo(() => session?.roster ?? [], [session?.roster]);
  const [lockStates, setLockStates] = useState({});
  const health = session?.health || null;
  const currentGoal = session?.communityGoal?.text || '';
  const goalUpdatedAt = session?.communityGoal?.updatedAt || null;
  const [goalDraft, setGoalDraft] = useState(currentGoal);

  const isAdmin =
    session?.role === 'admin' ||
    session?.role === 'lockdown' ||
    session?.role === 'lockdown-admin';

  const currentMode = session?.mode ?? 'open';

  const handleLockToggle = async (roverId, locked) => {
    try {
      await lockRover(roverId, locked);
      setLockStates((prev) => ({ ...prev, [roverId]: locked }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleModeChange = async (event) => {
    const mode = event.target.value;
    try {
      await setMode(mode);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleForceControl = async (roverId) => {
    try {
      await requestControl(roverId, { force: true });
    } catch (err) {
      alert(err.message);
    }
  };

  const handleGoalSave = async () => {
    try {
      await setCommunityGoal(goalDraft);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleGoalClear = async () => {
    try {
      await setCommunityGoal(null);
    } catch (err) {
      alert(err.message);
    }
  };

  useEffect(() => {
    setGoalDraft(currentGoal);
  }, [currentGoal]);

  const lockMap = useMemo(() => {
    const map = {};
    roster.forEach((rover) => {
      map[rover.id] = lockStates[rover.id] ?? rover.locked;
    });
    return map;
  }, [roster, lockStates]);

  if (!isAdmin) return null;

  return (
    <section className="panel-section space-y-0.5 text-base">
      <div className="flex items-center justify-between gap-0.5 text-sm">
        <span>Admin controls</span>
        <select value={currentMode} onChange={handleModeChange} className="field-input text-sm">
          {MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Community goal</span>
          {goalUpdatedAt ? (
            <span>Updated {new Date(goalUpdatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        <input
          type="text"
          value={goalDraft}
          onChange={(event) => setGoalDraft(event.target.value)}
          placeholder="Set a community goal"
          className="field-input text-sm"
        />
        <div className="flex gap-0.5 text-xs">
          <button type="button" onClick={handleGoalSave} className="button-dark">
            Set goal
          </button>
          <button type="button" onClick={handleGoalClear} className="button-danger">
            Clear
          </button>
        </div>
      </div>

      <RoverRoster
        roster={roster}
        renderActions={(rover) => (
          <div className="flex flex-wrap gap-0.5 text-xs">
            <button
              type="button"
              onClick={() => handleLockToggle(rover.id, !lockMap[rover.id])}
              className="button-dark"
            >
              {lockMap[rover.id] ? 'Unlock' : 'Lock'}
            </button>
            <button type="button" onClick={() => handleForceControl(rover.id)} className="button-dark">
              Force
            </button>
          </div>
        )}
      />
      <ReplaySnapshotHealth health={health} />
      <ModerationPanel
        moderation={moderation}
        onBan={banUser}
        onTimeout={timeoutUser}
        onUnban={unbanUser}
      />
      <AdminIpLogPanel entries={adminLogs} />
    </section>
  );
}

function ReplaySnapshotHealth({ health }) {
  if (!health) return null;
  const replay = health.replay || { sources: [], readyCount: 0, totalCount: 0 };
  const snapshots = health.snapshots || { rovers: [], rooms: [] };
  const replaySummary = `${replay.readyCount}/${replay.totalCount} sources ready`;
  const roverStale = snapshots.rovers.filter((entry) => entry.stale).length;
  const roomStale = snapshots.rooms.filter((entry) => entry.stale).length;
  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs uppercase">Health</div>
      <div className="surface space-y-0.5 text-xs text-slate-200">
        <div className="flex items-center justify-between">
          <span>Replay segments</span>
          <span className="text-slate-400">{replaySummary}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Rover snapshots</span>
          <span className={roverStale ? 'text-amber-300' : 'text-emerald-300'}>
            {snapshots.rovers.length - roverStale}/{snapshots.rovers.length} ok
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Room cameras</span>
          <span className={roomStale ? 'text-amber-300' : 'text-emerald-300'}>
            {snapshots.rooms.length - roomStale}/{snapshots.rooms.length} ok
          </span>
        </div>
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">
        {replay.sources.map((source) => (
          <div key={`${source.type}:${source.id}`} className="flex items-center justify-between">
            <span>{source.label}</span>
            <span className={source.ready ? 'text-emerald-300' : 'text-amber-300'}>
              {source.recentCount}/{source.neededCount}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">
        {snapshots.rovers.map((entry) => (
          <div key={`rover:${entry.id}`} className="flex items-center justify-between">
            <span>{entry.name}</span>
            <span className={entry.stale ? 'text-amber-300' : 'text-emerald-300'}>
              {entry.stale ? 'stale' : 'ok'}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">
        {snapshots.rooms.map((entry) => (
          <div key={`room:${entry.id}`} className="flex items-center justify-between">
            <span>{entry.name}</span>
            <span className={entry.stale ? 'text-amber-300' : 'text-emerald-300'}>
              {entry.error ? 'error' : entry.stale ? 'stale' : 'ok'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModerationPanel({ moderation, onBan, onTimeout, onUnban }) {
  const [filter, setFilter] = useState('');
  const [timeoutMinutes, setTimeoutMinutes] = useState(30);
  const [reason, setReason] = useState('');
  const users = moderation?.users || [];
  const normalized = filter.trim().toLowerCase();
  const filtered = normalized
    ? users.filter((user) => {
        const label = user.nicknames?.[user.nicknames.length - 1] || user.id || '';
        return (
          label.toLowerCase().includes(normalized) ||
          String(user.id).toLowerCase().includes(normalized) ||
          String(user.lastSocketId || '').toLowerCase().includes(normalized)
        );
      })
    : users;

  const handleBan = async (user) => {
    try {
      await onBan({ userId: user.id }, reason.trim() || null);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleTimeout = async (user) => {
    const durationMs = Math.max(1, Number(timeoutMinutes) || 0) * 60 * 1000;
    try {
      await onTimeout({ userId: user.id }, durationMs, reason.trim() || null);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUnban = async (user) => {
    try {
      await onUnban({ userId: user.id });
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="panel-muted text-xs uppercase">Moderation</span>
        <span className="text-slate-500">{filtered.length} users</span>
      </div>
      <div className="surface space-y-0.5 text-xs text-slate-200">
        <div className="flex flex-wrap items-center gap-0.5">
          <input
            className="field-input flex-1 min-w-[10rem] text-xs"
            placeholder="Search users"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <input
            className="field-input flex-1 min-w-[12rem] text-xs"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex items-center gap-0.25 text-xs text-slate-400">
            <span>Timeout (min)</span>
            <input
              className="field-input w-16 text-xs"
              type="number"
              min="1"
              value={timeoutMinutes}
              onChange={(event) => setTimeoutMinutes(event.target.value)}
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-500">No users tracked yet.</p>
        ) : (
          filtered
            .slice()
            .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
            .map((user) => {
              const label = user.nicknames?.[user.nicknames.length - 1] || user.id.slice(0, 6);
              const ban = user.ban || null;
              const isAdmin = Boolean(user.admin);
              return (
                <div key={user.id} className="surface-muted space-y-0.25 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-0.5">
                    <div className="flex flex-wrap items-center gap-0.5">
                      <span className="text-slate-100">{label}</span>
                      <span className="rounded bg-slate-800 px-1 text-[0.7rem] text-slate-300">
                        {user.id.slice(0, 6)}
                      </span>
                      {isAdmin && (
                        <span className="rounded bg-amber-500/30 px-1 text-[0.7rem] text-amber-200">
                          Admin
                        </span>
                      )}
                      {ban && (
                        <span className="rounded bg-red-500/30 px-1 text-[0.7rem] text-red-200">
                          {ban.expiresAt ? 'Timeout' : 'Banned'}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-0.25">
                      <button
                        type="button"
                        className="button-dark text-[0.7rem]"
                        onClick={() => handleBan(user)}
                        disabled={isAdmin}
                      >
                        Ban
                      </button>
                      <button
                        type="button"
                        className="button-dark text-[0.7rem]"
                        onClick={() => handleTimeout(user)}
                        disabled={isAdmin}
                      >
                        Timeout
                      </button>
                      <button
                        type="button"
                        className="button-danger text-[0.7rem]"
                        onClick={() => handleUnban(user)}
                        disabled={!ban}
                      >
                        Unban
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-0.5 text-[0.7rem] text-slate-400">
                    {user.lastSocketId && <span>socket {user.lastSocketId.slice(0, 6)}</span>}
                    {user.lastSeen && <span>last seen {new Date(user.lastSeen).toLocaleString()}</span>}
                    {ban?.expiresAt && (
                      <span>expires {new Date(ban.expiresAt).toLocaleString()}</span>
                    )}
                    {user.ips?.length ? (
                      <span>ips {user.ips.slice(-3).join(', ')}</span>
                    ) : null}
                  </div>
                </div>
              );
            })
        )}
      </div>
      <ModerationBanList bans={moderation?.bans || []} onUnban={onUnban} />
    </div>
  );
}

function ModerationBanList({ bans, onUnban }) {
  if (!bans.length) {
    return (
      <div className="surface text-xs text-slate-500">
        No active bans/timeouts.
      </div>
    );
  }
  return (
    <div className="surface space-y-0.5 text-xs text-slate-200">
      <div className="panel-muted text-xs uppercase text-slate-400">Active bans</div>
      {bans.map((ban) => (
        <div key={ban.id} className="flex flex-wrap items-center justify-between gap-0.5">
          <div className="flex flex-wrap items-center gap-0.5">
            <span className="rounded bg-slate-800 px-1 text-[0.7rem] text-slate-300">
              {ban.id.slice(0, 6)}
            </span>
            {ban.userId && (
              <span className="text-[0.7rem] text-slate-400">user {ban.userId.slice(0, 6)}</span>
            )}
            <span className="text-[0.7rem] text-slate-300">
              {ban.expiresAt ? 'timeout' : 'ban'}
            </span>
            {ban.expiresAt && (
              <span className="text-[0.7rem] text-slate-400">
                until {new Date(ban.expiresAt).toLocaleString()}
              </span>
            )}
            {ban.reason ? (
              <span className="text-[0.7rem] text-slate-400">reason {ban.reason}</span>
            ) : null}
          </div>
          <button
            type="button"
            className="button-danger text-[0.7rem]"
            onClick={() => onUnban({ banId: ban.id })}
          >
            Unban
          </button>
        </div>
      ))}
    </div>
  );
}

function AdminIpLogPanel({ entries }) {
  const logs = entries || [];
  return (
    <div className="panel-section space-y-0.5 text-base">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>Admin IP log</span>
        <span>{logs.length}</span>
      </div>
      <div className="surface h-64 overflow-y-auto font-mono text-xs">
        {logs.length === 0 ? (
          <p>No admin log entries yet.</p>
        ) : (
          logs
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className="surface">
                <span className="text-amber-400">
                  {entry.ts ? new Date(entry.ts).toLocaleTimeString() : '--'}
                </span>{' '}
                {entry.label && <span className="text-teal-400">[{entry.label}]</span>}{' '}
                <span className="text-slate-200">{entry.message}</span>{' '}
                {entry.ip && <span className="text-cyan-300">{entry.ip}</span>}{' '}
                {entry.meta && <span className="text-slate-500">{JSON.stringify(entry.meta)}</span>}
              </div>
            ))
        )}
      </div>
      <p className="text-xs text-slate-500">Admin-only log stream; IPs never appear in user data.</p>
    </div>
  );
}
