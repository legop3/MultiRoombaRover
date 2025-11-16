import { useEffect, useMemo, useState } from 'react';
import { useSession } from './context/SessionContext.jsx';
import { useTelemetryFrame } from './context/TelemetryContext.jsx';
import TelemetryPanel from './components/TelemetryPanel.jsx';
import VideoTile from './components/VideoTile.jsx';
import DrivePanel from './components/DrivePanel.jsx';
import AlertFeed from './components/AlertFeed.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import MobileControls, { MobileJoystick, AuxMotorControls } from './components/MobileControls.jsx';
import { DriveControlProvider } from './context/DriveControlContext.jsx';
import { useVideoRequests } from './hooks/useVideoRequests.js';

function StatusBadge({ connected, role, mode }) {
  const color = connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-200';
  return (
    <div className="flex flex-wrap items-center gap-1 text-[0.65rem] uppercase tracking-[0.2em]">
      <span className={`rounded-full px-2 py-0.5 font-medium ${color}`}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-slate-200">
        Role {role || 'unknown'}
      </span>
      <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-slate-200">
        Mode {mode || '--'}
      </span>
    </div>
  );
}

function RoomCameraPanel() {
  return (
    <div className="min-h-[8rem] rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-[0.75rem] text-slate-400">
      <p className="text-center text-xs uppercase tracking-[0.3em] text-slate-500">Room camera</p>
      <p className="mt-2 text-center text-sm text-slate-300">Feed placeholder. Wire upcoming room cam here.</p>
    </div>
  );
}

function useLayoutMode() {
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return 'desktop';
    return window.innerWidth >= 1024
      ? 'desktop'
      : window.innerWidth > window.innerHeight
      ? 'mobile-landscape'
      : 'mobile-portrait';
  });

  useEffect(() => {
    function updateMode() {
      if (typeof window === 'undefined') return;
      const { innerWidth, innerHeight } = window;
      if (innerWidth >= 1024) {
        setMode('desktop');
      } else if (innerWidth > innerHeight) {
        setMode('mobile-landscape');
      } else {
        setMode('mobile-portrait');
      }
    }
    updateMode();
    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  return mode;
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

function DriverVideoPanel() {
  const { session } = useSession();
  const roverId = session?.assignment?.roverId;
  const sources = useVideoRequests(roverId ? [roverId] : []);
  const info = roverId ? sources[roverId] : null;
  const frame = useTelemetryFrame(roverId);
  const batteryConfig = useMemo(() => {
    if (!roverId) return null;
    const record = session?.roster?.find((item) => item.id === roverId);
    return record?.battery ?? null;
  }, [session?.roster, roverId]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Video Feed</p>
          <h2 className="text-2xl font-semibold text-white">
            {roverId ? `Rover ${roverId}` : 'No rover assigned'}
          </h2>
        </div>
      </header>
      {roverId ? (
        <VideoTile
          sessionInfo={info}
          label={roverId}
          muted={false}
          telemetryFrame={frame}
          batteryConfig={batteryConfig}
        />
      ) : (
        <p className="text-sm text-slate-400">Assignment required to initialize video.</p>
      )}
    </section>
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

function DesktopLayout() {
  return (
    <div className="flex flex-col gap-2">
      <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
        <TelemetryPanel />
        <DriverVideoPanel />
        <DrivePanel />
      </section>
      <section className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <div className="flex flex-col gap-2">
          <AuthPanel />
          <AdminPanel />
          <RosterPanel />
        </div>
        <RoomCameraPanel />
        <div className="flex flex-col gap-2">
          <AssignmentCard />
          <LogPanel />
          <SessionInspector />
        </div>
      </section>
    </div>
  );
}

function MobilePortraitLayout() {
  return (
    <div className="flex flex-col gap-2">
      <DriverVideoPanel />
      <MobileControls />
      <DrivePanel />
      <TelemetryPanel />
      <RosterPanel />
      <AssignmentCard />
      <AuthPanel />
      <AdminPanel />
      <RoomCameraPanel />
      <LogPanel />
      <SessionInspector />
    </div>
  );
}

function MobileLandscapeLayout() {
  return (
    <div className="flex flex-col gap-2">
      <section className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,0.9fr)] gap-2">
        <div className="flex flex-col gap-2">
          <DrivePanel />
          <AuxMotorControls />
        </div>
        <DriverVideoPanel />
        <div className="flex flex-col gap-2">
          <MobileJoystick />
          <TelemetryPanel />
        </div>
      </section>
      <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <div className="flex flex-col gap-2">
          <RosterPanel />
          <AssignmentCard />
          <AuthPanel />
          <AdminPanel />
        </div>
        <div className="flex flex-col gap-2">
          <RoomCameraPanel />
          <LogPanel />
          <SessionInspector />
        </div>
      </section>
    </div>
  );
}

function App() {
  const { connected, session } = useSession();
  const layout = useLayoutMode();
  const renderedLayout = layout === 'desktop' ? <DesktopLayout /> : layout === 'mobile-landscape' ? <MobileLandscapeLayout /> : <MobilePortraitLayout />;

  return (
    <div className="min-h-screen bg-black text-slate-50">
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-2 px-1 py-1">
        <DriveControlProvider>
          <div className="flex justify-end">
            <StatusBadge connected={connected} role={session?.role} mode={session?.mode} />
          </div>
          {renderedLayout}
          <AlertFeed />
        </DriveControlProvider>
      </main>
    </div>
  );
}

export default App;
