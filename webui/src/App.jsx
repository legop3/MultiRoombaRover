import { useEffect, useState } from 'react';
import TelemetryPanel from './components/TelemetryPanel.jsx';
import DrivePanel from './components/DrivePanel.jsx';
import AlertFeed from './components/AlertFeed.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import MobileControls, {
  MobileLandscapeAuxColumn,
  MobileLandscapeControlColumn,
} from './components/MobileControls.jsx';
import { ControlSystemProvider, KeyboardInputManager, GamepadInputManager } from './controls/index.js';
import { SettingsProvider } from './settings/index.js';
import RoomCameraPanel from './components/RoomCameraPanel.jsx';
import LogPanel from './components/LogPanel.jsx';
import AuthPanel from './components/AuthPanel.jsx';
import DriverVideoPanel from './components/DriverVideoPanel.jsx';
import RightPaneTabs from './components/RightPaneTabs.jsx';
import ModeGateOverlay from './components/ModeGateOverlay.jsx';
import SessionSnapshot from './components/SessionSnapshot.jsx';

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

function DesktopLayout({ layout }) {
  return (
    <div className="flex flex-col gap-0.5">
      <section className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] gap-0.5">
        <DriverVideoPanel />
        <RightPaneTabs layout={layout} />
      </section>
      <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-0.5">
        {/* <AdminPanel /> */}
        <LogPanel />
        <SessionSnapshot />
      </section>
    </div>
  );
}

function MobilePortraitLayout() {
  return (
    <div className="flex flex-col gap-0.5">
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
    <div className="flex flex-col gap-0.5">
      <section className="grid min-h-screen grid-cols-[minmax(0,0.7fr)_minmax(0,2.1fr)_minmax(0,0.7fr)] gap-0.5">
        <MobileLandscapeAuxColumn />
        <DriverVideoPanel />
        <MobileLandscapeControlColumn />
      </section>
      <div className="flex flex-col gap-0.5 pb-0.5">
        <RoomCameraPanel />
        <DrivePanel />
        <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-0.5">
          <div className="flex flex-col gap-0.5">
            <AuthPanel />
            <AdminPanel />
          </div>
          <div className="flex flex-col gap-0.5">
            <LogPanel />
            <TelemetryPanel />
          </div>
        </section>
      </div>
    </div>
  );
}

function App() {
  const layout = useLayoutMode();
  const renderedLayout =
    layout === 'desktop'
      ? <DesktopLayout layout={layout} />
      : layout === 'mobile-landscape'
      ? <MobileLandscapeLayout />
      : <MobilePortraitLayout />;

  return (
    <div className="min-h-screen bg-black text-slate-100">
      <SettingsProvider>
        <ControlSystemProvider>
          <KeyboardInputManager />
          <GamepadInputManager />
          <main className="flex w-full flex-col gap-0.5 text-base">{renderedLayout}</main>
          <AlertFeed />
          <ModeGateOverlay />
        </ControlSystemProvider>
      </SettingsProvider>
    </div>
  );
}

export default App;
