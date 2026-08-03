// Mobile Driver Layout Frame
// Purpose: Owns behavior and framing shared exclusively by portrait and landscape driver layouts.
// Scope: Keeps fullscreen, mobile telemetry policy, objective banner, and snap framing out of the shared driver root.
import { useCallback } from 'react';
import FloatingFullscreenButton from '../../../components/FloatingFullscreenButton/index.jsx';
import FullscreenPrompt from '../../../components/FullscreenPrompt/index.jsx';
import GlobalObjectiveBanner from '../../../components/GlobalObjectiveBanner/index.jsx';
import { useTelemetryVisualPolicy } from '../../../context/TelemetryContext.jsx';
import { useFullscreenPrompt } from '../../../hooks/useFullscreenPrompt.js';
import { useSettingsNamespace } from '../../../settings/index.js';
import { themeGapClass } from '../../../themes/index.js';
import { useDriverLayout } from '../DriverLayoutContext.jsx';
import './styles.css';

export default function MobileLayoutFrame({ children }) {
  const layout = useDriverLayout();
  useTelemetryVisualPolicy({ mobile: true });
  const fullscreen = useFullscreenPrompt(layout);
  const { value: pageSettings } = useSettingsNamespace('page', { swapMobileControlColumns: false });
  const buttonSide = pageSettings?.swapMobileControlColumns ? 'left' : 'right';
  const showButton = fullscreen.isIOS || fullscreen.nativeSupported;

  const handleFloatingFullscreen = useCallback(async () => {
    if (fullscreen.isIOS) {
      fullscreen.showPrompt();
      return;
    }
    const entered = await fullscreen.enterFullscreen();
    if (!entered) fullscreen.showPrompt();
  }, [fullscreen]);

  return (
    <div className={`driver-mobile-layout min-h-screen flex flex-col ${themeGapClass}`}>
      {/* The absolute marker creates the literal page-top snap without taking flex space. */}
      <div className="mobile-top-snap" aria-hidden="true" />
      <GlobalObjectiveBanner layout={layout} />
      {children}
      <FullscreenPrompt
        visible={fullscreen.visible}
        mode={fullscreen.mode}
        onEnterFullscreen={fullscreen.enterFullscreen}
        onDismiss={fullscreen.dismiss}
      />
      {showButton ? <FloatingFullscreenButton side={buttonSide} onClick={handleFloatingFullscreen} /> : null}
    </div>
  );
}
