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

function RoomCameraPanel() {
  return (
    <div className="min-h-[8rem] rounded-sm bg-[#1b1b1b] p-1 text-sm text-slate-200">
      <p className="text-center text-xs text-slate-400">Room camera</p>
      <p className="mt-1 text-center text-sm text-slate-200">Feed placeholder. Wire upcoming room cam here.</p>
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
    <div className="rounded-sm bg-[#1b1b1b] p-1 text-xs text-slate-200">
      <div className="flex items-center justify-between text-[0.7rem] text-slate-400">
        <span>Server logs</span>
        <span>{logs.length}</span>
      </div>
      <div className="mt-1 h-48 overflow-y-auto rounded-sm bg-black/40 p-1 font-mono text-[0.65rem] text-slate-300">
        {logs.length === 0 ? (
          <p>No logs yet.</p>
        ) : (
          logs
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className="mb-1">
                <span className="text-slate-500">{entry.timestamp}</span>{' '}
                <span className="text-slate-300">[{entry.level}]</span>{' '}
                {entry.label && <span className="text-slate-400">[{entry.label}]</span>}{' '}
                <span>{entry.message}</span>
              </div>
            ))
        )}
      </div>
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
    <section className="rounded-sm bg-[#1b1b1b] p-1">
      {roverId ? (
        <div className="min-h-[55vh]">
          <VideoTile
            sessionInfo={info}
            label={roverId}
            muted={false}
            telemetryFrame={frame}
            batteryConfig={batteryConfig}
          />
        </div>
      ) : (
        <p className="text-sm text-slate-400">Assign a rover to view the video feed.</p>
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
    <div className="rounded-sm bg-[#1b1b1b] p-1 text-sm text-slate-200">
      <p className="text-xs text-slate-400">Admin login</p>
      <form className="mt-1 flex flex-col gap-1" onSubmit={handleLogin}>
        <input
          className="rounded-sm bg-black/50 px-1 py-1 text-slate-100"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="rounded-sm bg-black/50 px-1 py-1 text-slate-100"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-sm bg-slate-200 px-1 py-1 text-xs font-semibold text-black disabled:opacity-50"
        >
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>
      <div className="mt-1 flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setRole('user')}
          className="flex-1 rounded-sm bg-black/40 px-1 py-1 text-slate-200"
        >
          Driver
        </button>
        <button
          type="button"
          onClick={() => setRole('spectator')}
          className="flex-1 rounded-sm bg-black/40 px-1 py-1 text-slate-200"
        >
          Spectator
        </button>
      </div>
    </div>
  );
}

function DesktopLayout() {
  return (
    <div className="flex flex-col gap-1">
      <section className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)_minmax(0,0.9fr)] gap-1">
        <TelemetryPanel />
        <DriverVideoPanel />
        <DrivePanel />
      </section>
      <section className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1">
        <div className="flex flex-col gap-1">
          <AuthPanel />
          <AdminPanel />
        </div>
        <RoomCameraPanel />
        <LogPanel />
      </section>
    </div>
  );
}

function MobilePortraitLayout() {
  return (
    <div className="flex flex-col gap-1">
      <DriverVideoPanel />
      <MobileControls />
      <DrivePanel />
      <TelemetryPanel />
      <AuthPanel />
      <AdminPanel />
      <RoomCameraPanel />
      <LogPanel />
    </div>
  );
}

function MobileLandscapeLayout() {
  return (
    <div className="flex flex-col gap-1">
      <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-1">
        <div className="flex flex-col gap-1">
          <DrivePanel />
          <AuxMotorControls />
        </div>
        <DriverVideoPanel />
        <div className="flex flex-col gap-1">
          <MobileJoystick />
          <TelemetryPanel />
        </div>
      </section>
      <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        <div className="flex flex-col gap-1">
          <AuthPanel />
          <AdminPanel />
        </div>
        <div className="flex flex-col gap-1">
          <RoomCameraPanel />
          <LogPanel />
        </div>
      </section>
    </div>
  );
}

function App() {
  const layout = useLayoutMode();
  const renderedLayout = layout === 'desktop' ? <DesktopLayout /> : layout === 'mobile-landscape' ? <MobileLandscapeLayout /> : <MobilePortraitLayout />;

  return (
    <div className="min-h-screen bg-black text-slate-50">
      <DriveControlProvider>
        <main className="flex w-full flex-col gap-1 px-1 py-1">{renderedLayout}</main>
        <AlertFeed />
      </DriveControlProvider>
    </div>
  );
}

export default App;
