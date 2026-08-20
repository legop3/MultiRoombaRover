// Main Application Shell
// Purpose: Composes the primary rover control interface and page-level layout. Scope: Orchestrates high-level panels, overlays, and feature modules for the default route.
import { useCallback, useEffect, useState } from 'react';
import AlertFeed from '../components/AlertFeed/index.jsx';
import {
  ControlSystemProvider,
  KeyboardInputManager,
  GamepadInputManager,
} from '../controls/index.js';
import ModeGateOverlay from '../components/ModeGateOverlay/index.jsx';
import TurnAlertListener from '../components/TurnAlertListener/index.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import HelpOverlay from '../components/HelpOverlay/index.jsx';
import QuickstartOverlay from '../components/QuickstartOverlay/index.jsx';
import useDefaultNickname from '../hooks/useDefaultNickname.js';
import useUserIdentitySync from '../hooks/useUserIdentitySync.js';
import useIncomingInterInstanceTransfer from '../hooks/useIncomingInterInstanceTransfer.js';
import RewardRunOverlay from '../components/RewardRunOverlay/index.jsx';
import SocketConnectionPill from '../components/SocketConnectionPill/index.jsx';
import DuplicateIdentityOverlay from '../components/DuplicateIdentityOverlay/index.jsx';
import {
  DEFAULT_PAGE_THEME_KEY,
  themeGapClass,
  usePageThemeClass,
} from '../themes/index.js';
import useLayoutMode from '../hooks/useLayoutMode.js';
import { DriverLayoutProvider } from '../layouts/driver/DriverLayoutContext.jsx';
import DriverLayoutRoot from '../layouts/driver/DriverLayoutRoot.jsx';
import UndockedPageExitGuard from '../components/UndockedPageExitGuard/index.jsx';

/* Driver-page compositions live under layouts/driver. App retains only global providers, overlays, and route-level state. */
function DriverPageRoot({ oldDesktop = false }) {
  const layout = useLayoutMode();
  const { value: pageSettings } = useSettingsNamespace('page', {
    backgroundTheme: DEFAULT_PAGE_THEME_KEY,
  });
  // Resolve the cookie value through the shared catalog before painting the page. This prevents
  // an obsolete or hand-edited key from stripping the background class from every exposed seam.
  const pageBackgroundClass = usePageThemeClass(pageSettings?.backgroundTheme);

  return (
    <div className={`${pageBackgroundClass} text-slate-100`}>
      <DriverPageContent layout={layout} oldDesktop={oldDesktop} />
    </div>
  );
}

function DriverPageContent({ layout, oldDesktop }) {
  useDefaultNickname();
  useIncomingInterInstanceTransfer();
  useUserIdentitySync({ identitySurface: 'driver' });

  const {
    value: helpSettings,
    save: saveHelpSettings,
  } = useSettingsNamespace('help', { showOnLoad: true });
  const {
    value: quickstartSettings,
    status: quickstartStatus,
    save: saveQuickstartSettings,
  } = useSettingsNamespace('quickstart', { showOnLoad: true });
  const [helpVisible, setHelpVisible] = useState(false);
  const [quickstartVisible, setQuickstartVisible] = useState(false);

  useEffect(() => {
    if (quickstartStatus === 'ready') {
      setQuickstartVisible(quickstartSettings?.showOnLoad !== false);
    }
  }, [quickstartStatus, quickstartSettings?.showOnLoad]);

  const openHelp = useCallback(() => {
    setHelpVisible(true);
  }, []);
  const closeHelp = useCallback(() => {
    setHelpVisible(false);
  }, []);
  const closeQuickstart = useCallback(() => {
    setQuickstartVisible(false);
  }, []);
  const setQuickstartShowOnLoad = useCallback(
    (enabled) => {
      const next = Boolean(enabled);
      saveQuickstartSettings((current) => ({ ...(current ?? {}), showOnLoad: next }));
      if (!next) {
        setQuickstartVisible(false);
      }
    },
    [saveQuickstartSettings],
  );
  return (
    <ControlSystemProvider>
      {/*
        Keep document-exit protection inside the control provider so it follows
        the same assigned-rover identity as every driving command. Mounting it
        only on the driver page leaves spectator and utility routes unchanged.
      */}
      <UndockedPageExitGuard />
      <KeyboardInputManager />
      <GamepadInputManager />
      <main className={`relative flex w-full flex-col ${themeGapClass} text-base`}>
        <DriverLayoutProvider layout={layout} openHelp={openHelp}>
          {/* Route selection affects only which desktop composition is mounted;
              all providers, overlays, inputs, and mobile layouts remain shared. */}
          <DriverLayoutRoot oldDesktop={oldDesktop} />
        </DriverLayoutProvider>
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
      <QuickstartOverlay
        visible={quickstartVisible}
        layout={layout}
        showOnLoad={quickstartSettings?.showOnLoad !== false}
        onToggleShowOnLoad={setQuickstartShowOnLoad}
        onClose={closeQuickstart}
      />
    </ControlSystemProvider>
  );
}

export default DriverPageRoot;
