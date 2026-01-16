import { useCallback, useEffect, useMemo, useState } from 'react';
import TelemetryPanel from './components/TelemetryPanel.jsx';
import ControlSummary, { RoverRosterPanel } from './components/ControlSummary.jsx';
import ReplaySourcesPanel from './components/ReplaySourcesPanel.jsx';
import AlertFeed from './components/AlertFeed.jsx';
import MobileControls, {
  MobileLandscapeAuxColumn,
  MobileLandscapeControlColumn,
} from './components/MobileControls.jsx';
import { ControlSystemProvider, KeyboardInputManager, GamepadInputManager } from './controls/index.js';
import { SettingsProvider } from './settings/index.js';
import RoomCameraPanel from './components/RoomCameraPanel.jsx';
import LogPanel from './components/LogPanel.jsx';
import DriverVideoPanel from './components/DriverVideoPanel.jsx';
import RightPaneTabs from './components/RightPaneTabs.jsx';
import ModeGateOverlay from './components/ModeGateOverlay.jsx';
import HomeAssistantControls from './components/HomeAssistantControls.jsx';
import TurnAlertListener from './components/TurnAlertListener.jsx';
import UserListPanel from './components/UserListPanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import FullscreenPrompt from './components/FullscreenPrompt.jsx';
import { useFullscreenPrompt } from './hooks/useFullscreenPrompt.js';
import { useSettingsNamespace } from './settings/index.js';
import HelpOverlay from './components/HelpOverlay.jsx';
import HelpPanel from './components/HelpPanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './components/Tabs.jsx';
import useDefaultNickname from './hooks/useDefaultNickname.js';
import CommunityGoalBanner from './components/CommunityGoalBanner.jsx';

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

function DesktopLayout({ layout, onOpenHelpOverlay }) {
  return (
    <div className="flex h-full gap-0.5 overflow-hidden">
      <div className="flex min-w-0 flex-[1.8] flex-col gap-0.5 overflow-y-auto pr-0.5">
        <DriverVideoPanel />
        <div className="grid h-52 grid-cols-2 gap-0.5">
          <div className="h-full min-h-0">
            <UserListPanel fillHeight />
          </div>
          <div className="h-full min-h-0">
            <ChatPanel fillHeight />
          </div>
        </div>
        <LogPanel />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <CommunityGoalBanner layout={layout} />
        <RightPaneTabs layout={layout} onOpenHelpOverlay={onOpenHelpOverlay} />
        {/* <SessionSnapshot /> */}
      </div>
    </div>
  );
}

function MobileFeatureTabs({
  layout,
  onOpenHelpOverlay,
  roomPanelId,
  showTelemetry = true,
}) {
  return (
    <section className="panel text-base">
      <Tabs defaultTab="chat">
        <TabList>
          <Tab id="chat">Chat</Tab>
          <Tab id="roomcontrols">Room Controls</Tab>
          <Tab id="help">Help</Tab>
          <Tab id="settings">Settings</Tab>
        </TabList>
        <TabPanels>
          <TabPanel id="chat">
            <div className="space-y-0.5">
              <ChatPanel />
              <UserListPanel />
            </div>
          </TabPanel>
          <TabPanel id="roomcontrols">
            <div className="space-y-0.5">
              {/* {showTelemetry ? <TelemetryPanel /> : null} */}
              <HomeAssistantControls />
              <RoomCameraPanel panelId={roomPanelId} />
            </div>
          </TabPanel>
          <TabPanel id="help">
            <HelpPanel layout={layout} onOpenOverlay={onOpenHelpOverlay} />
          </TabPanel>
          <TabPanel id="settings">
            <div className="space-y-0.5">
              <SettingsPanel />
              <LogPanel />
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}

function MobilePortraitLayout({ onOpenHelpOverlay }) {
  return (
    <div className="flex flex-col gap-0.5">
      <DriverVideoPanel layoutFormat="mobile-portrait" />
      <MobileControls />
      <div className="grid gap-0.5 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ReplaySourcesPanel panelId="replay-sources-mobile-portrait" />
        <RoverRosterPanel />
      </div>
      {/* <ControlSummary /> */}
      <MobileFeatureTabs
        layout="mobile-portrait"
        onOpenHelpOverlay={onOpenHelpOverlay}
        roomPanelId="mobile-portrait-room"
      />
    </div>
  );
}

function MobileLandscapeLayout({ onOpenHelpOverlay }) {
  return (
    <div className="flex flex-col gap-0.5">
      <section className="grid min-h-screen grid-cols-[minmax(0,0.7fr)_minmax(0,2.1fr)_minmax(0,0.7fr)] gap-0.5">
        <MobileLandscapeAuxColumn />
        <div>
          <DriverVideoPanel layoutFormat="mobile-landscape" />
          <div className="grid gap-0.5 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <ReplaySourcesPanel panelId="replay-sources-mobile-landscape" />
            <RoverRosterPanel />
          </div>
          {/* <TelemetryPanel /> */}
        </div>
        <MobileLandscapeControlColumn />
      </section>
      <div className="flex flex-col gap-0.5 pb-0.5">
        <MobileFeatureTabs
          layout="mobile-landscape"
          onOpenHelpOverlay={onOpenHelpOverlay}
          roomPanelId="mobile-landscape-room"
          showTelemetry={false}
        />
      </div>
    </div>
  );
}

function App() {
  const layout = useLayoutMode();
  const isDesktop = layout === 'desktop';
  const fullscreen = useFullscreenPrompt(layout);

  return (
    <div className={`bg-black text-slate-100 ${isDesktop ? 'h-screen overflow-hidden' : 'min-h-screen'}`}>
      <SettingsProvider>
        <AppWithProviders layout={layout} isDesktop={isDesktop} fullscreen={fullscreen} />
      </SettingsProvider>
    </div>
  );
}

function AppWithProviders({ layout, isDesktop, fullscreen }) {
  useDefaultNickname();
  const {
    visible: fullscreenVisible,
    mode: fullscreenMode,
    enterFullscreen,
    dismiss,
  } = fullscreen;

  const {
    value: helpSettings,
    status: helpStatus,
    save: saveHelpSettings,
  } = useSettingsNamespace('help', { showOnLoad: true });
  const [helpVisible, setHelpVisible] = useState(false);

  useEffect(() => {
    if (helpStatus === 'ready') {
      setHelpVisible(helpSettings?.showOnLoad !== false);
    }
  }, [helpStatus, helpSettings?.showOnLoad]);

  const openHelp = useCallback(() => setHelpVisible(true), []);
  const closeHelp = useCallback(() => setHelpVisible(false), []);
  const setShowOnLoad = useCallback(
    (enabled) => {
      const next = Boolean(enabled);
      saveHelpSettings((current) => ({ ...(current ?? {}), showOnLoad: next }));
      if (!next) {
        setHelpVisible(false);
      }
    },
    [saveHelpSettings],
  );

  const renderedLayout = useMemo(
    () =>
      isDesktop
        ? <DesktopLayout layout={layout} onOpenHelpOverlay={openHelp} />
        : layout === 'mobile-landscape'
        ? <MobileLandscapeLayout onOpenHelpOverlay={openHelp} />
        : <MobilePortraitLayout onOpenHelpOverlay={openHelp} />,
    [isDesktop, layout, openHelp],
  );

  return (
    <ControlSystemProvider>
      <KeyboardInputManager />
      <GamepadInputManager />
      <main className={`flex w-full flex-col gap-0.5 text-base ${isDesktop ? 'h-full overflow-hidden' : ''}`}>
        {!isDesktop ? <CommunityGoalBanner layout={layout} /> : null}
        {renderedLayout}
      </main>
      <AlertFeed />
      <TurnAlertListener />
      <ModeGateOverlay />
      <HelpOverlay
        visible={helpVisible}
        layout={layout}
        onClose={closeHelp}
        showOnLoad={helpSettings?.showOnLoad !== false}
        onToggleShowOnLoad={setShowOnLoad}
      />
      <FullscreenPrompt
        visible={fullscreenVisible}
        mode={fullscreenMode}
        onEnterFullscreen={enterFullscreen}
        onDismiss={dismiss}
      />
    </ControlSystemProvider>
  );
}

export default App;
