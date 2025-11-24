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
import HomeAssistantControls from './components/HomeAssistantControls.jsx';
import TurnAlertListener from './components/TurnAlertListener.jsx';
import UserListPanel from './components/UserListPanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import FullscreenPrompt from './components/FullscreenPrompt.jsx';
import { useFullscreenPrompt } from './hooks/useFullscreenPrompt.js';

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
    <div className="flex h-full gap-0.5 overflow-hidden">
      <div className="flex min-w-0 flex-[1.8] flex-col gap-0.5 overflow-y-auto pr-0.5">
        <DriverVideoPanel />
        <div className="grid grid-cols-2 gap-0.5 h-50">
          <div className="h-full">
            <UserListPanel fullHeight />
          </div>
          <div className="h-full">
            <ChatPanel fullHeight />
          </div>
        </div>
        <LogPanel />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <RightPaneTabs layout={layout} />
        {/* <SessionSnapshot /> */}
      </div>
    </div>
  );
}

function MobilePortraitLayout() {
  return (
    <div className="flex flex-col gap-0.5">
      <DriverVideoPanel layoutFormat='mobile'/>
      <MobileControls />
      <ChatPanel />
      <UserListPanel />
      <DrivePanel />
      <TelemetryPanel />
      <AuthPanel />
      <AdminPanel />
      <RoomCameraPanel />
      <HomeAssistantControls />
      <LogPanel />
    </div>
  );
}

function MobileLandscapeLayout() {
  return (
    <div className="flex flex-col gap-0.5">
      <section className="grid min-h-screen grid-cols-[minmax(0,0.7fr)_minmax(0,2.1fr)_minmax(0,0.7fr)] gap-0.5">
        <MobileLandscapeAuxColumn />
        <div>
          <DriverVideoPanel layoutFormat='mobile'/>
          <TelemetryPanel />
        </div>
        <MobileLandscapeControlColumn />
      </section>
      <div className="flex flex-col gap-0.5 pb-0.5">
        <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-0.5">
          <div className="flex flex-col gap-0.5">
            {/* <AuthPanel /> */}
            {/* <AdminPanel /> */}
            <UserListPanel />
          </div>
          <div className="flex flex-col gap-0.5">
            {/* <LogPanel /> */}
            <ChatPanel />
          </div>
        </section>
        <RoomCameraPanel />
        <HomeAssistantControls />
        {/* <DrivePanel /> */}
      </div>
    </div>
  );
}

function App() {
  const layout = useLayoutMode();
  const isDesktop = layout === 'desktop';
  const { visible: fullscreenVisible, mode: fullscreenMode, enterFullscreen, dismiss } = useFullscreenPrompt(layout);
  const renderedLayout =
    isDesktop
      ? <DesktopLayout layout={layout} />
      : layout === 'mobile-landscape'
      ? <MobileLandscapeLayout />
      : <MobilePortraitLayout />;

  return (
    <div className={`bg-black text-slate-100 ${isDesktop ? 'h-screen overflow-hidden' : 'min-h-screen'}`}>
      <SettingsProvider>
        <ControlSystemProvider>
          <KeyboardInputManager />
          <GamepadInputManager />
          <main className={`flex w-full flex-col gap-0.5 text-base ${isDesktop ? 'h-full overflow-hidden' : ''}`}>
            {renderedLayout}
          </main>
          <AlertFeed />
          <TurnAlertListener />
          <ModeGateOverlay />
          <FullscreenPrompt
            visible={fullscreenVisible}
            mode={fullscreenMode}
            onEnterFullscreen={enterFullscreen}
            onDismiss={dismiss}
          />
        </ControlSystemProvider>
      </SettingsProvider>
    </div>
  );
}

export default App;
