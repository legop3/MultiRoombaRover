import { useEffect, useState } from 'react';
import TelemetryPanel from './components/TelemetryPanel.jsx';
import DrivePanel from './components/DrivePanel.jsx';
import AlertFeed from './components/AlertFeed.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import MobileControls, { MobileJoystick, AuxMotorControls } from './components/MobileControls.jsx';
import { DriveControlProvider } from './context/DriveControlContext.jsx';
import RoomCameraPanel from './components/RoomCameraPanel.jsx';
import LogPanel from './components/LogPanel.jsx';
import AuthPanel from './components/AuthPanel.jsx';
import DriverVideoPanel from './components/DriverVideoPanel.jsx';
import RightPaneTabs from './components/RightPaneTabs.jsx';

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
    <div className="flex flex-col gap-1">
      <section className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] gap-1">
        <DriverVideoPanel />
        <RightPaneTabs layout={layout} />
      </section>
      <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        <AdminPanel />
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
          <AuxMotorControls />
        </div>
        <DriverVideoPanel />
        <div className="flex flex-col gap-1">
          <MobileJoystick />
        </div>
      </section>
      <RoomCameraPanel />
      <DrivePanel />
      <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        <div className="flex flex-col gap-1">
          <AuthPanel />
          <AdminPanel />
        </div>
        <div className="flex flex-col gap-1">
          <LogPanel />
          <TelemetryPanel />
        </div>
      </section>
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
    <div className="min-h-screen bg-black text-slate-50">
      <DriveControlProvider>
        <main className="flex w-full flex-col gap-1 px-1 py-1 text-base">{renderedLayout}</main>
        <AlertFeed />
      </DriveControlProvider>
    </div>
  );
}

export default App;
