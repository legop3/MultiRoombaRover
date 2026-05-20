// Hook: useFullscreenPrompt
// Purpose: Manages fullscreen prompt visibility and dismissal logic across screen sizes/devices. Scope: Provides reusable fullscreen UX state and action handlers.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettingsNamespace } from '../settings/index.js';

const MOBILE_LAYOUTS = new Set(['mobile-portrait', 'mobile-landscape']);

const detectIOS = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.platform || '';
  return /iphone|ipad|ipod/i.test(ua);
};

const supportsFullscreen = () => {
  if (typeof document === 'undefined') return false;
  const doc = document;
  return Boolean(
    doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.mozFullScreenEnabled ||
      doc.msFullscreenEnabled,
  );
};

export function useFullscreenPrompt(layout) {
  const { value: pageSettings, save: savePageSettings, status: settingsStatus } = useSettingsNamespace('page', {
    fullscreenPromptShown: false,
  });
  const isMobileLayout = MOBILE_LAYOUTS.has(layout);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState('native');
  const [forceVisible, setForceVisible] = useState(false);
  const hasShownPrompt = Boolean(pageSettings?.fullscreenPromptShown);
  const isIOS = useMemo(() => detectIOS(), []);
  const nativeSupported = useMemo(() => supportsFullscreen(), []);
  const markShown = useCallback(() => {
    if (settingsStatus !== 'ready') return;
    savePageSettings((current) => {
      if (current?.fullscreenPromptShown) return current;
      return { ...(current || {}), fullscreenPromptShown: true };
    });
  }, [savePageSettings, settingsStatus]);

  const reevaluate = useCallback(() => {
    if (settingsStatus !== 'ready') {
      setVisible(false);
      return;
    }
    if (!isMobileLayout) {
      setVisible(false);
      setForceVisible(false);
      return;
    }
    if (!forceVisible && hasShownPrompt) {
      setVisible(false);
      return;
    }
    if (isIOS) {
      setMode('pwa-hint');
      setVisible(true);
      return;
    }
    if (!supportsFullscreen()) {
      setVisible(false);
      return;
    }
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      setVisible(false);
      return;
    }
    setMode('native');
    setVisible(true);
  }, [forceVisible, hasShownPrompt, isIOS, isMobileLayout, settingsStatus]);

  useEffect(() => {
    reevaluate();
  }, [reevaluate]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handler = () => {
      if (document.fullscreenElement) {
        setForceVisible(false);
        setVisible(false);
        return;
      }
      reevaluate();
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, [reevaluate]);

  const dismiss = useCallback(() => {
    markShown();
    setForceVisible(false);
    setVisible(false);
  }, [markShown]);

  const enterFullscreen = useCallback(async () => {
    if (!isMobileLayout || isIOS) return false;
    if (typeof document === 'undefined') return false;
    if (document.fullscreenElement) return true;
    const element = document.documentElement;
    if (!element) return false;
    const request =
      element.requestFullscreen ||
      element.webkitRequestFullscreen ||
      element.mozRequestFullScreen ||
      element.msRequestFullscreen;
    if (!request) return false;
    try {
      const result = request.call(element);
      if (result && typeof result.then === 'function') {
        await result;
      }
      markShown();
      setForceVisible(false);
      setVisible(false);
      return true;
    } catch (error) {
      console.warn('Failed to enter fullscreen', error);
      return false;
    }
  }, [isIOS, isMobileLayout, markShown]);

  const showPrompt = useCallback(() => {
    if (!isMobileLayout) return;
    setForceVisible(true);
    setMode(isIOS ? 'pwa-hint' : 'native');
    setVisible(true);
  }, [isIOS, isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout) {
      setForceVisible(false);
      setVisible(false);
    }
  }, [isMobileLayout]);

  return {
    visible,
    mode,
    isIOS,
    nativeSupported,
    enterFullscreen,
    dismiss,
    showPrompt,
  };
}

export default useFullscreenPrompt;
