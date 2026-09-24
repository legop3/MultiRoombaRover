import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CardFrame from '../components/CardFrame/index.jsx';
import { useControlActions } from '../controls/index.js';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';
import { isFeatureEnabled } from '../lib/features.js';
import { useSettingsNamespace } from '../settings/index.js';
import { DEFAULT_PAGE_THEME_KEY, usePageThemeClass } from '../themes/index.js';
import usePtzSession from './usePtzSession.js';
import { PtzDesktopFullscreen, PtzMobileLandscape, PtzMobilePortrait } from './components/PtzLayouts.jsx';

export default function PtzControllerPage({ layout = 'desktop' }) {
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const featureEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'ptzCamera'));
  const { setOperatingMode, pushAlert } = useSessionActions();
  const { stopAllMotion } = useControlActions();
  const navigate = useNavigate();
  const [releasePending, setReleasePending] = useState(false);
  const { value: pageSettings } = useSettingsNamespace('page', {
    backgroundTheme: DEFAULT_PAGE_THEME_KEY,
  });
  const isMobile = layout !== 'desktop';
  // PTZ is a separate route but shares the browser's page settings. Applying the catalog class to
  // its body surface exposes the theme only through layout padding and card gaps; camera pixels,
  // controls, and card interiors retain their purpose-built dark backgrounds.
  const pageBackgroundClass = usePageThemeClass(pageSettings?.backgroundTheme);

  const { entryError, retryEntry } = usePtzSession();

  const releaseAndClose = useCallback(async () => {
    if (releasePending) return;
    setReleasePending(true);
    try {
      /*
        Stop first so a held key/pointer cannot leave ONVIF continuous movement
        running while the server removes this socket from the PTZ queue.
      */
      stopAllMotion?.();
      await setOperatingMode('rover');
      navigate('/');
    } catch (err) {
      pushAlert({ title: 'PTZ camera', message: err.message, color: '#f59e0b' });
    } finally {
      setReleasePending(false);
    }
  }, [navigate, pushAlert, setOperatingMode, releasePending, stopAllMotion]);

  if (!featureEnabled) {
    return (
      <main className={`flex min-h-dvh items-center justify-center p-2 text-slate-100 ${pageBackgroundClass}`}>
        <CardFrame title="PTZ camera" bodyClassName="space-y-1 p-2 text-sm">
          <p>The PTZ camera is not available.</p>
          <button type="button" className="button-dark w-full" onClick={() => navigate('/')}>Return to driver page</button>
        </CardFrame>
      </main>
    );
  }

  return (
    <main className={`h-dvh w-full overflow-hidden text-slate-100 ${pageBackgroundClass}`}>
      {/* The fullscreen CardFrame remains the structural shell. Painting its otherwise
          transparent body is what lets every desktop and mobile PTZ composition share one
          continuous pattern without threading theme props into each individual child panel. */}
      <CardFrame
        title={isMobile ? '' : ptz?.name || 'PTZ Camera'}
        actions={isMobile ? null : (
          <button type="button" className="button-dark text-xs" disabled={releasePending} onClick={releaseAndClose}>
            Close
          </button>
        )}
        hideHeader={isMobile}
        fillHeight
        clipOverflow={false}
        className="h-dvh w-screen rounded-none border-0 bg-black!"
        bodyClassName={`relative min-h-0 flex-1 ${pageBackgroundClass}`}
      >
        {entryError || ptz?.error || ptz?.participation?.denialReason ? (
          <div className="shrink-0 p-1 text-sm text-amber-200">
            {ptz?.participation?.denialReason || entryError || ptz?.error}
            {ptz?.permissions?.canEnter ? <button type="button" className="button-dark ml-1" onClick={retryEntry}>Retry entry</button> : null}
          </div>
        ) : null}
        {isMobile ? (
          layout === 'mobile-landscape' ? (
            <PtzMobileLandscape ptz={ptz} onClose={releaseAndClose} releasePending={releasePending} />
          ) : (
            <PtzMobilePortrait ptz={ptz} onClose={releaseAndClose} releasePending={releasePending} />
          )
        ) : (
          <PtzDesktopFullscreen ptz={ptz} releasePending={releasePending} />
        )}
      </CardFrame>
    </main>
  );
}
