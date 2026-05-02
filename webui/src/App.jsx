// Main Application Shell
// Purpose: Composes the primary rover control interface and page-level layout. Scope: Orchestrates high-level panels, overlays, and feature modules for the default route.
import { useCallback, useEffect, useMemo, useState } from 'react';
import TelemetryPanel from './components/TelemetryPanel/index.jsx';
import ReplaySourcesPanel from './components/ReplaySourcesPanel/index.jsx';
import AlertFeed from './components/AlertFeed/index.jsx';
import MobileControls, {
  MobileActionsColumn,
  MobileDriveColumn,
} from './components/MobileControls/index.jsx';
import {
  ControlSystemProvider,
  KeyboardInputManager,
  GamepadInputManager,
  useControlSystem,
} from './controls/index.js';
import RoomCameraPanel from './components/RoomCameraPanel/index.jsx';
import LogPanel from './components/LogPanel/index.jsx';
import DriverVideoPanel from './components/DriverVideoPanel/index.jsx';
import RightPaneTabs from './components/RightPaneTabs/index.jsx';
import ModeGateOverlay from './components/ModeGateOverlay/index.jsx';
import HomeAssistantControls from './components/HomeAssistantControls/index.jsx';
import TurnAlertListener from './components/TurnAlertListener/index.jsx';
import RawUserPilePanel from './components/RawUserPilePanel/index.jsx';
import ChatPanel from './components/ChatPanel/index.jsx';
import FullscreenPrompt from './components/FullscreenPrompt/index.jsx';
import FloatingFullscreenButton from './components/FloatingFullscreenButton/index.jsx';
import { useFullscreenPrompt } from './hooks/useFullscreenPrompt.js';
import { useSettingsNamespace } from './settings/index.js';
import HelpOverlay from './components/HelpOverlay/index.jsx';
import HelpPanel from './components/HelpPanel/index.jsx';
import SettingsPanel from './components/SettingsPanel/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './components/Tabs/index.jsx';
import useDefaultNickname from './hooks/useDefaultNickname.js';
import useUserIdentitySync from './hooks/useUserIdentitySync.js';
import GlobalObjectiveBanner from './components/GlobalObjectiveBanner/index.jsx';
import RoverQueuesPanel from './components/RoverQueuesPanel/index.jsx';
import VipPanel from './components/VipPanel/index.jsx';
import { useSessionSelector } from './context/SessionContext.jsx';
import ButtonBoxPanel from './components/ButtonBoxPanel/index.jsx';
import RewardRunOverlay from './components/RewardRunOverlay/index.jsx';

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
      <div className="flex min-w-0 flex-[1.22] flex-col gap-0.5 overflow-y-auto pr-0">
        <DriverVideoPanel />
        <TelemetryPanel />
        <LogPanel />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <GlobalObjectiveBanner layout={layout} />
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
  const [activeTab, setActiveTab] = useState('chat');
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const ownRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());
  const ownAudioForward = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    return roverId ? state.session?.audioForward?.[roverId] || null : null;
  });
  const { state: controlState } = useControlSystem();
  const { value: vipAudio } = useSettingsNamespace('vipAudio', { openMicEnabled: false, pttMode: 'live' });
  const vipDotClass = isVerified ? 'bg-emerald-400' : 'bg-amber-400';
  const pttActive = Boolean(controlState?.mic?.pttActive);
  const openMicEnabled = Boolean(vipAudio?.openMicEnabled);
  const pttMode = vipAudio?.pttMode === 'clip' ? 'clip' : 'live';
  const vipMicActive = Boolean(
    ownRoverId &&
      isVerified &&
      (pttMode === 'clip' ? pttActive : (openMicEnabled || pttActive)),
  );
  const vipClipPlaying = Boolean(
    ownRoverId &&
      isVerified &&
      pttMode === 'clip' &&
      ownAudioForward?.source === 'upload' &&
      ownAudioForward?.state === 'playing',
  );
  return (
    <section className="panel text-base">
      <Tabs defaultTab="chat" currentTab={activeTab} onTabChange={setActiveTab}>
        <TabList>
          <Tab id="chat">Chat</Tab>
          <Tab id="vip" highlight={vipClipPlaying ? 'green' : vipMicActive ? 'pink' : 'none'}>
            <span className="inline-flex items-center gap-0.5">
              <span>VIP</span>
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${vipDotClass}`}
                aria-hidden="true"
                title={isVerified ? 'Verified' : 'Not verified'}
              />
            </span>
          </Tab>
          <Tab id="roomcontrols">Room Controls</Tab>
          <Tab id="help">Help</Tab>
          <Tab id="settings">Settings</Tab>
        </TabList>
        <TabPanels>
          <TabPanel id="chat">
            <div className="space-y-0.5">
              <ChatPanel />
              <RawUserPilePanel />
            </div>
          </TabPanel>
          <TabPanel id="vip" keepMounted>
            <VipPanel isActive={activeTab === 'vip'} />
          </TabPanel>
          <TabPanel id="roomcontrols">
            <div className="space-y-0.5">
              {/* {showTelemetry ? <TelemetryPanel /> : null} */}
              <HomeAssistantControls />
              <ButtonBoxPanel />
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

function MobilePortraitLayout({ onOpenHelpOverlay, swapMobileControlColumns = false }) {
  return (
    <div className="flex flex-col gap-0.5">
      <DriverVideoPanel layoutFormat="mobile-portrait" />
      <MobileControls swapColumns={swapMobileControlColumns} />
      <div className="grid gap-0.5 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ReplaySourcesPanel panelId="replay-sources-mobile-portrait" />
        <RoverQueuesPanel />
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

function MobileLandscapeLayout({ onOpenHelpOverlay, swapMobileControlColumns = false }) {
  const columnClass = 'self-start h-[min(100svh,32rem)]';
  const firstColumn = swapMobileControlColumns
    ? <MobileDriveColumn layout="landscape" className={columnClass} />
    : <MobileActionsColumn layout="landscape" className={columnClass} />;
  const secondColumn = swapMobileControlColumns
    ? <MobileActionsColumn layout="landscape" className={columnClass} />
    : <MobileDriveColumn layout="landscape" className={columnClass} />;
  return (
    <div className="flex flex-col gap-0.5">
      <section className="grid min-h-screen grid-cols-[minmax(0,0.7fr)_minmax(0,2.1fr)_minmax(0,0.7fr)] gap-0.5">
        {firstColumn}
        <div>
          <DriverVideoPanel layoutFormat="mobile-landscape" />
          <div className="grid gap-0.5 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <ReplaySourcesPanel panelId="replay-sources-mobile-landscape" />
            <RoverQueuesPanel />
          </div>
          {/* <TelemetryPanel /> */}
        </div>
        {secondColumn}
      </section>
      <div className="flex flex-col gap-0.5 pb-0">
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
      <AppWithProviders layout={layout} isDesktop={isDesktop} fullscreen={fullscreen} />
    </div>
  );
}

function AppWithProviders({ layout, isDesktop, fullscreen }) {
  useDefaultNickname();
  useUserIdentitySync();
  const {
    visible: fullscreenVisible,
    mode: fullscreenMode,
    isIOS: fullscreenIsIOS,
    nativeSupported: fullscreenNativeSupported,
    enterFullscreen,
    dismiss,
    showPrompt,
  } = fullscreen;

  const {
    value: helpSettings,
    status: helpStatus,
    save: saveHelpSettings,
  } = useSettingsNamespace('help', { showOnLoad: true });
  const { value: pageSettings } = useSettingsNamespace('page', {
    swapMobileControlColumns: false,
  });
  const swapMobileControlColumns = Boolean(pageSettings?.swapMobileControlColumns);
  const fullscreenButtonSide = swapMobileControlColumns ? 'left' : 'right';
  const showFloatingFullscreenButton = !isDesktop && (fullscreenIsIOS || fullscreenNativeSupported);
  const [helpVisible, setHelpVisible] = useState(false);

  useEffect(() => {
    if (helpStatus === 'ready') {
      setHelpVisible(helpSettings?.showOnLoad !== false);
    }
  }, [helpStatus, helpSettings?.showOnLoad]);

  const openHelp = useCallback(() => setHelpVisible(true), []);
  const closeHelp = useCallback(() => setHelpVisible(false), []);
  const handleFloatingFullscreen = useCallback(async () => {
    if (fullscreenIsIOS) {
      showPrompt();
      return;
    }
    const entered = await enterFullscreen();
    if (!entered) {
      showPrompt();
    }
  }, [enterFullscreen, fullscreenIsIOS, showPrompt]);
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
        ? <MobileLandscapeLayout onOpenHelpOverlay={openHelp} swapMobileControlColumns={swapMobileControlColumns} />
        : <MobilePortraitLayout onOpenHelpOverlay={openHelp} swapMobileControlColumns={swapMobileControlColumns} />,
    [isDesktop, layout, openHelp, swapMobileControlColumns],
  );

  return (
    <ControlSystemProvider>
      <KeyboardInputManager />
      <GamepadInputManager />
      <main className={`flex w-full flex-col gap-0.5 text-base ${isDesktop ? 'h-full overflow-hidden' : ''}`}>
        {!isDesktop ? <GlobalObjectiveBanner layout={layout} /> : null}
        {renderedLayout}
      </main>
      <AlertFeed />
      <RewardRunOverlay />
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
      {showFloatingFullscreenButton ? (
        <FloatingFullscreenButton
          side={fullscreenButtonSide}
          onClick={handleFloatingFullscreen}
        />
      ) : null}
    </ControlSystemProvider>
  );
}

export default App;
