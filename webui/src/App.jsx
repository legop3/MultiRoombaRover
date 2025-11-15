import { useMemo, useState } from 'react';
import { useSession } from './context/SessionContext.jsx';

function StatusBadge({ connected, role, mode }) {
  const color = connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-200';
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className={`rounded-full px-3 py-1 font-medium ${color}`}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      <span className="rounded-full bg-slate-800/80 px-3 py-1 text-slate-200">
        Role: {role || 'unknown'}
      </span>
      <span className="rounded-full bg-slate-800/80 px-3 py-1 text-slate-200">
        Mode: {mode || '--'}
      </span>
    </div>
  );
}

function LogPanel() {
  const { logs } = useSession();
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Server logs</h2>
        <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
          {logs.length} entries
        </span>
      </header>
      <div className="h-64 overflow-y-auto rounded-xl bg-slate-950/40 p-3 text-xs font-mono text-slate-300">
        {logs.length === 0 ? (
          <p>No logs yet.</p>
        ) : (
          logs
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className="mb-2">
                <span className="text-slate-500">{entry.timestamp}</span>{' '}
                <span className="text-cyan-300">[{entry.level}]</span>{' '}
                {entry.label && <span className="text-pink-300">[{entry.label}]</span>}{' '}
                <span>{entry.message}</span>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

function RosterPanel() {
  const { session, requestControl } = useSession();
  const roster = session?.roster ?? [];
  const isAdmin = session?.role === 'admin' || session?.role === 'lockdown';
  const [pending, setPending] = useState({});

  async function handleRequest(roverId) {
    setPending((prev) => ({ ...prev, [roverId]: true }));
    try {
      await requestControl(roverId);
    } catch (err) {
      alert(err.message);
    } finally {
      setPending((prev) => ({ ...prev, [roverId]: false }));
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-lg font-semibold text-white">Rovers</h2>
      <div className="mt-4 space-y-3">
        {roster.length === 0 && <p className="text-slate-400">No rovers registered.</p>}
        {roster.map((rover) => (
          <div
            key={rover.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-950/40 px-4 py-3"
          >
            <div>
              <p className="text-white">{rover.name}</p>
              <p className="text-xs text-slate-400">Locked: {rover.locked ? 'yes' : 'no'}</p>
            </div>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => handleRequest(rover.id)}
                disabled={pending[rover.id]}
                className="rounded-full bg-blue-600 px-4 py-1 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending[rover.id] ? 'Requesting…' : 'Request control'}
              </button>
            ) : (
              <span className="text-xs text-slate-500">Auto-assigned</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AssignmentCard() {
  const { session, releaseControl } = useSession();
  const assignment = session?.assignment;
  const roverId = assignment?.roverId;

  const [busy, setBusy] = useState(false);

  async function handleRelease() {
    if (!roverId) return;
    setBusy(true);
    try {
      await releaseControl(roverId);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-lg font-semibold text-white">Assignment</h2>
      {roverId ? (
        <div className="mt-4 space-y-3">
          <p className="text-slate-300">Currently driving rover {roverId}</p>
          <button
            type="button"
            onClick={handleRelease}
            disabled={busy}
            className="rounded-full bg-red-600 px-4 py-1 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Releasing…' : 'Release control'}
          </button>
        </div>
      ) : (
        <div className="mt-4 text-slate-400">
          <p>Status: {assignment?.status ?? 'not assigned'}</p>
          {assignment?.queuePosition && (
            <p>Queue position: {assignment.queuePosition}</p>
          )}
        </div>
      )}
    </div>
  );
}

function SessionInspector() {
  const { session } = useSession();
  const formatted = useMemo(() => JSON.stringify(session ?? {}, null, 2), [session]);
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-lg font-semibold text-white">Session snapshot</h2>
      <pre className="mt-4 max-h-64 overflow-y-auto text-sm text-teal-200">{formatted}</pre>
    </div>
  );
}

function AuthPanel() {
  const { login, setRole } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
      setUsername('');
      setPassword('');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-lg font-semibold text-white">Authentication</h2>
      <form className="mt-4 flex flex-col gap-3" onSubmit={handleLogin}>
        <input
          className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-white"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-white"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-emerald-600 py-2 font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Logging in…' : 'Login as admin'}
        </button>
      </form>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => setRole('user')}
          className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200"
        >
          Driver mode
        </button>
        <button
          type="button"
          onClick={() => setRole('spectator')}
          className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200"
        >
          Spectator mode
        </button>
      </div>
    </div>
  );
}

function App() {
  const { connected, session } = useSession();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="space-y-4">
          <h1 className="text-4xl font-semibold text-white">Multi Roomba Rover Console</h1>
          <StatusBadge connected={connected} role={session?.role} mode={session?.mode} />
        </header>
        <section className="grid gap-6 lg:grid-cols-2">
          <RosterPanel />
          <AssignmentCard />
          <AuthPanel />
          <SessionInspector />
        </section>
        <LogPanel />
      </main>
    </div>
  );
}

export default App;
