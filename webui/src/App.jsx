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
    <div className="min-h-[8rem] rounded-sm bg-[#242a32] p-2 text-base text-slate-100">
      <p className="text-center text-sm text-slate-400">Room camera</p>
      <p className="mt-1 text-center">Feed placeholder. Wire upcoming room cam here.</p>
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
    <div className="rounded-sm bg-[#242a32] p-2 text-base text-slate-100">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>Server logs</span>
        <span>{logs.length}</span>
      </div>
      <div className="mt-2 h-48 overflow-y-auto rounded-sm bg-black/40 p-2 font-mono text-sm text-slate-300">
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
    <section className="rounded-sm bg-[#242a32] p-1">
      {roverId ? (
        <div className="min-h-[70vh]">
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
    <div className="rounded-sm bg-[#242a32] p-2 text-base text-slate-100">
      <p className="text-sm text-slate-400">Admin login</p>
      <form className="mt-2 flex flex-col gap-2" onSubmit={handleLogin}>
        <input
          className="rounded-sm bg-black/50 px-2 py-1 text-slate-100"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="rounded-sm bg-black/50 px-2 py-1 text-slate-100"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-sm bg-slate-200 px-2 py-1 text-sm font-semibold text-black disabled:opacity-50"
        >
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>
      <div className="mt-2 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setRole('user')}
          className="flex-1 rounded-sm bg-black/40 px-2 py-1 text-slate-200"
        >
          Driver
        </button>
        <button
          type="button"
          onClick={() => setRole('spectator')}
          className="flex-1 rounded-sm bg-black/40 px-2 py-1 text-slate-200"
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
      <section className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,2.2fr)_minmax(0,0.6fr)] gap-1">
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
      <section className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,2.1fr)_minmax(0,0.7fr)] gap-1">
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
        <main className="flex w-full flex-col gap-1 px-1 py-1 text-base">{renderedLayout}</main>
        <AlertFeed />
      </DriveControlProvider>
    </div>
  );
}

export default App;
