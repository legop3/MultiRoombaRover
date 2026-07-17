// Main Application Shell
// Purpose: Composes the primary rover control interface and page-level layout. Scope: Orchestrates high-level panels, overlays, and feature modules for the default route.
import { useCallback, useEffect, useMemo, useState } from 'react';
import TelemetryPanel from './components/TelemetryPanel/index.jsx';
import PiHostStatsCard from './components/PiHostStatsCard/index.jsx';
import ReplaySourcesPanel from './components/ReplaySourcesPanel/index.jsx';
import AlertFeed from './components/AlertFeed/index.jsx';
import AuxColumn from './components/MobileControls/AuxColumn.jsx';
import MovementColumn from './components/MobileControls/MovementColumn.jsx';
import {
  ControlSystemProvider,
  KeyboardInputManager,
  GamepadInputManager,
  useControlSelector,
} from './controls/index.js';
import RoomCameraPanel from './components/RoomCameraPanel/index.jsx';
import KinectPanel from './components/KinectPanel/index.jsx';
import BalanceBoardPanel from './components/BalanceBoardPanel/index.jsx';
import DriverVideo from './components/DriverVideo/index.jsx';
import RightPaneTabs from './components/RightPaneTabs/index.jsx';
import ModeGateOverlay from './components/ModeGateOverlay/index.jsx';
import HomeAssistantControls from './components/HomeAssistantControls/index.jsx';
import TurnAlertListener from './components/TurnAlertListener/index.jsx';
import RawUserPilePanel from './components/RawUserPilePanel/index.jsx';
import OverseerPreferencePanel from './components/OverseerPreferencePanel/index.jsx';
import SocialButtonsGrid from './components/SocialButtonsGrid/index.jsx';
import ChatPanel from './components/ChatPanel/index.jsx';
import FullscreenPrompt from './components/FullscreenPrompt/index.jsx';
import FloatingFullscreenButton from './components/FloatingFullscreenButton/index.jsx';
import { useFullscreenPrompt } from './hooks/useFullscreenPrompt.js';
import { useSettingsNamespace } from './settings/index.js';
import HelpOverlay from './components/HelpOverlay/index.jsx';
import QuickstartOverlay from './components/QuickstartOverlay/index.jsx';
import HelpPanel from './components/HelpPanel/index.jsx';
import SettingsPanel from './components/SettingsPanel/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './components/Tabs/index.jsx';
import useDefaultNickname from './hooks/useDefaultNickname.js';
import useUserIdentitySync from './hooks/useUserIdentitySync.js';
import useIncomingInterInstanceTransfer from './hooks/useIncomingInterInstanceTransfer.js';
import GlobalObjectiveBanner from './components/GlobalObjectiveBanner/index.jsx';
import RoverQueuesPanel from './components/RoverQueuesPanel/index.jsx';
import PtzQueueCard from './components/PtzCamera/index.jsx';
import VipPanel from './components/VipPanel/index.jsx';
import { useSessionSelector } from './context/SessionContext.jsx';
import { useTelemetryVisualPolicy } from './context/TelemetryContext.jsx';
import ButtonBoxPanel from './components/ButtonBoxPanel/index.jsx';
import BarcodeGamesPanel from './components/BarcodeGamesPanel/index.jsx';
import OdometerPanel from './components/OdometerPanel/index.jsx';
import LiftCard from './components/LiftCard/index.jsx';
import NeatoCard from './components/NeatoCard/index.jsx';
import RewardRunOverlay from './components/RewardRunOverlay/index.jsx';
import SocketConnectionPill from './components/SocketConnectionPill/index.jsx';
import DuplicateIdentityOverlay from './components/DuplicateIdentityOverlay/index.jsx';
import { pageBackgroundClass, themeGapClass, themeStackClass } from './themeFlags.js';
import { trackAnalyticsEvent } from './analytics/index.js';
import useLayoutMode from './hooks/useLayoutMode.js';

function DesktopLayout({ layout, onOpenHelpOverlay }) {
  return (
    <div className={`flex h-full ${themeGapClass} overflow-hidden`}>
      <div className={`flex min-w-0 flex-[1.22] flex-col ${themeGapClass} overflow-y-auto pr-0`}>
        <DriverVideo />
        <PiHostStatsCard />
        {/* <TelemetryPanel /> */}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col ${themeGapClass} overflow-y-auto`}>
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
}) {
  const [activeTab, setActiveTab] = useState('chat');
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const ownRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());
  const ownAudioForward = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    return roverId ? state.session?.audioForward?.[roverId] || null : null;
  });
  const pttActive = useControlSelector((control) => Boolean(control.state.mic?.pttActive));
  const { value: vipAudio } = useSettingsNamespace('vipAudio', { openMicEnabled: false, pttMode: 'live' });
  const vipDotClass = isVerified ? 'bg-emerald-400' : 'bg-amber-400';
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
  const showOverseerPreferencePanel = useSessionSelector((state) => {
    const vote = state.session?.overseerVote;

    // Match the panel's server-owned voting gate so the mobile chat row can
    // collapse to a single-column layout when voting is unavailable, including
    // disabled service and direct-address mode.
    return Boolean(vote?.votingEnabled);
  });
  const handleTabChange = useCallback(
    (tab) => {
      /*
        Tab changes are one of the highest-signal UI events because the app is a
        dense single-page control surface. Recording the selected panel gives
        Umami useful journeys without tracking every button inside each panel.
      */
      setActiveTab(tab);
      trackAnalyticsEvent('tab_change', { tab, layout, surface: 'mobile_features' });
    },
    [layout],
  );
  return (
    <section className="text-base">
      <Tabs defaultTab="chat" currentTab={activeTab} onTabChange={handleTabChange}>
        <TabList>
          <Tab id="chat">Chat</Tab>
          <Tab id="activities">Activities</Tab> 
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
            <div className={themeStackClass}>
              <ChatPanel nicknameLayout="stacked" />
              <div className={themeStackClass}>
                <div className={`grid ${themeGapClass} md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`}>
                  <SocialButtonsGrid />
                </div>
                <div
                  className={`grid ${themeGapClass} ${
                    showOverseerPreferencePanel
                      ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
                      : 'grid-cols-[minmax(0,1fr)]'
                  }`}
                >
                  {/*
                    The overseer vote panel is server-vote-gated. When voting
                    is unavailable, the raw user pile should reclaim the row
                    instead of sitting in a half-empty two-column layout.
                  */}
                  {showOverseerPreferencePanel ? <OverseerPreferencePanel /> : null}
                  <RawUserPilePanel hideNicknameForm />
                </div>
              </div>
            </div>
          </TabPanel>
          {/* activities tab */}
          <TabPanel id="activities">
            <div className={`flex flex-col ${themeGapClass}`}>
              <NeatoCard />
              <LiftCard />
              <BarcodeGamesPanel />
              <OdometerPanel />
              <ButtonBoxPanel />
              <KinectPanel />
              <BalanceBoardPanel />
            </div>
          </TabPanel>
          <TabPanel id="vip" keepMounted>
            <VipPanel isActive={activeTab === 'vip'} layout={layout} />
          </TabPanel>
          <TabPanel id="roomcontrols">
            <div className={themeStackClass}>
              {/* {showTelemetry ? <TelemetryPanel /> : null} */}
              <HomeAssistantControls />
              <RoomCameraPanel panelId={roomPanelId} />
            </div>
          </TabPanel>
          <TabPanel id="help">
            <HelpPanel layout={layout} onOpenOverlay={onOpenHelpOverlay} />
          </TabPanel>
          <TabPanel id="settings">
            <div className={themeStackClass}>
              <SettingsPanel />
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}

function MobilePortraitLayout({ onOpenHelpOverlay, swapMobileControlColumns = false }) {
  const columnHeight = 'h-[min(60svh,24rem)]';
  const firstColumn = swapMobileControlColumns
    ? <MovementColumn layout="portrait" className={columnHeight} />
    : <AuxColumn layout="portrait" className={columnHeight} />;
  const secondColumn = swapMobileControlColumns
    ? <AuxColumn layout="portrait" className={columnHeight} />
    : <MovementColumn layout="portrait" className={columnHeight} />;

  return (
    <div className={`flex flex-col ${themeGapClass}`}>
      <DriverVideo layoutFormat="mobile-portrait" />
      {/* Portrait owns the two-column placement because the same reusable mobile
          columns sit in different grid contexts in portrait and landscape. */}
      <section className="mobile-touch-control text-white">
        <div className="mobile-touch-control grid grid-cols-2 gap-0.5 items-stretch">
          {firstColumn}
          {secondColumn}
        </div>
      </section>
      <div className={`grid ${themeGapClass} grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]`}>
        <ReplaySourcesPanel panelId="replay-sources-mobile-portrait" />
        <div className="space-y-0.5">
          <RoverQueuesPanel />
          <PtzQueueCard layout="mobile-portrait" />
        </div>
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
    ? <MovementColumn layout="landscape" className={columnClass} />
    : <AuxColumn layout="landscape" className={columnClass} />;
  const secondColumn = swapMobileControlColumns
    ? <AuxColumn layout="landscape" className={columnClass} />
    : <MovementColumn layout="landscape" className={columnClass} />;
  return (
    <div className={`flex flex-col ${themeGapClass}`}>
      <section className={`grid min-h-screen grid-cols-[minmax(0,0.7fr)_minmax(0,2.1fr)_minmax(0,0.7fr)] ${themeGapClass}`}>
        {firstColumn}
        <div>
          <DriverVideo layoutFormat="mobile-landscape" />
          <div className={`grid ${themeGapClass} grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]`}>
            <ReplaySourcesPanel panelId="replay-sources-mobile-landscape" />
            <div className="space-y-0.5">
              <RoverQueuesPanel />
              <PtzQueueCard layout="mobile-landscape" />
            </div>
          </div>
          {/* <TelemetryPanel /> */}
        </div>
        {secondColumn}
      </section>
      <div className={`flex flex-col ${themeGapClass} pb-0`}>
        <MobileFeatureTabs
          layout="mobile-landscape"
          onOpenHelpOverlay={onOpenHelpOverlay}
          roomPanelId="mobile-landscape-room"
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
    <div className={`${pageBackgroundClass} text-slate-100 ${isDesktop ? 'h-screen overflow-hidden' : 'ios-safe-screen min-h-screen'}`}>
      <AppWithProviders layout={layout} isDesktop={isDesktop} fullscreen={fullscreen} />
    </div>
  );
}

function AppWithProviders({ layout, isDesktop, fullscreen }) {
  useDefaultNickname();
  useIncomingInterInstanceTransfer();
  useUserIdentitySync({ identitySurface: 'driver' });
  useTelemetryVisualPolicy({ mobile: !isDesktop });
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
    save: saveHelpSettings,
  } = useSettingsNamespace('help', { showOnLoad: true });
  const {
    value: quickstartSettings,
    status: quickstartStatus,
    save: saveQuickstartSettings,
  } = useSettingsNamespace('quickstart', { showOnLoad: true });
  const { value: pageSettings } = useSettingsNamespace('page', {
    swapMobileControlColumns: false,
  });
  const swapMobileControlColumns = Boolean(pageSettings?.swapMobileControlColumns);
  const fullscreenButtonSide = swapMobileControlColumns ? 'left' : 'right';
  const showFloatingFullscreenButton = !isDesktop && (fullscreenIsIOS || fullscreenNativeSupported);
  const [helpVisible, setHelpVisible] = useState(false);
  const [quickstartVisible, setQuickstartVisible] = useState(false);

  useEffect(() => {
    if (quickstartStatus === 'ready') {
      setQuickstartVisible(quickstartSettings?.showOnLoad !== false);
    }
  }, [quickstartStatus, quickstartSettings?.showOnLoad]);

  useEffect(() => {
    if (!fullscreenVisible) return;
    trackAnalyticsEvent('fullscreen_prompt_show', { layout, mode: fullscreenMode });
  }, [fullscreenMode, fullscreenVisible, layout]);

  useEffect(() => {
    if (!quickstartVisible) return;
    trackAnalyticsEvent('quickstart_open', { layout });
  }, [layout, quickstartVisible]);

  const openHelp = useCallback(() => {
    setHelpVisible(true);
    trackAnalyticsEvent('help_open', { layout, source: 'panel' });
  }, [layout]);
  const closeHelp = useCallback(() => {
    setHelpVisible(false);
    trackAnalyticsEvent('help_close', { layout });
  }, [layout]);
  const closeQuickstart = useCallback(() => {
    setQuickstartVisible(false);
    trackAnalyticsEvent('quickstart_close', { layout });
  }, [layout]);
  const handleFloatingFullscreen = useCallback(async () => {
    if (fullscreenIsIOS) {
      trackAnalyticsEvent('fullscreen_prompt_manual_open', { layout, mode: 'pwa-hint', source: 'floating_button' });
      showPrompt();
      return;
    }
    const entered = await enterFullscreen();
    trackAnalyticsEvent(entered ? 'fullscreen_enter' : 'fullscreen_enter_failed', {
      layout,
      source: 'floating_button',
    });
    if (!entered) {
      showPrompt();
    }
  }, [enterFullscreen, fullscreenIsIOS, layout, showPrompt]);
  const setQuickstartShowOnLoad = useCallback(
    (enabled) => {
      const next = Boolean(enabled);
      saveQuickstartSettings((current) => ({ ...(current ?? {}), showOnLoad: next }));
      trackAnalyticsEvent('quickstart_show_on_load_change', { layout, enabled: next });
      if (!next) {
        setQuickstartVisible(false);
      }
    },
    [layout, saveQuickstartSettings],
  );
  const openHelpFromQuickstart = useCallback(() => {
    setQuickstartVisible(false);
    setHelpVisible(true);
    trackAnalyticsEvent('help_open', { layout, source: 'quickstart' });
  }, [layout]);
  const handleFullscreenPromptEnter = useCallback(async () => {
    const entered = await enterFullscreen();
    trackAnalyticsEvent(entered ? 'fullscreen_enter' : 'fullscreen_enter_failed', {
      layout,
      source: 'prompt',
    });
    return entered;
  }, [enterFullscreen, layout]);
  const handleFullscreenPromptDismiss = useCallback(() => {
    dismiss();
    trackAnalyticsEvent('fullscreen_dismiss', { layout, mode: fullscreenMode });
  }, [dismiss, fullscreenMode, layout]);

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
      <main className={`flex w-full flex-col ${themeGapClass} text-base ${isDesktop ? 'h-full overflow-hidden' : ''}`}>
        {!isDesktop ? <GlobalObjectiveBanner layout={layout} /> : null}
        {renderedLayout}
      </main>
      <AlertFeed />
      <DuplicateIdentityOverlay />
      <RewardRunOverlay />
      <TurnAlertListener />
      <ModeGateOverlay />
      <SocketConnectionPill />

      <HelpOverlay
        visible={helpVisible}
        layout={layout}
        onClose={closeHelp}
        showOnLoad={helpSettings?.showOnLoad !== false}
        onToggleShowOnLoad={(enabled) => saveHelpSettings((current) => ({ ...(current ?? {}), showOnLoad: Boolean(enabled) }))}
      />
      <FullscreenPrompt
        visible={fullscreenVisible}
        mode={fullscreenMode}
        onEnterFullscreen={handleFullscreenPromptEnter}
        onDismiss={handleFullscreenPromptDismiss}
      />
      <QuickstartOverlay
        visible={quickstartVisible}
        layout={layout}
        showOnLoad={quickstartSettings?.showOnLoad !== false}
        onToggleShowOnLoad={setQuickstartShowOnLoad}
        onOpenHelp={openHelpFromQuickstart}
        onClose={closeQuickstart}
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
