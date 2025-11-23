import { useCallback, useEffect, useMemo, useState } from 'react';

const SESSION_KEY = 'fullscreenPromptDismissed';
const MOBILE_LAYOUTS = new Set(['mobile-portrait', 'mobile-landscape']);

const getStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const isDismissed = () => {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
};

const markDismissed = () => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
};

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
  const isMobileLayout = MOBILE_LAYOUTS.has(layout);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState('native');
  const isIOS = useMemo(() => detectIOS(), []);

  const reevaluate = useCallback(() => {
    if (!isMobileLayout) {
      setVisible(false);
      return;
    }
    if (isDismissed()) {
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
  }, [isIOS, isMobileLayout]);

  useEffect(() => {
    reevaluate();
  }, [reevaluate]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handler = () => {
      if (document.fullscreenElement) {
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
    markDismissed();
    setVisible(false);
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (!isMobileLayout || isIOS) return false;
    if (typeof document === 'undefined') return false;
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
      markDismissed();
      setVisible(false);
      return true;
    } catch (error) {
      console.warn('Failed to enter fullscreen', error);
      return false;
    }
  }, [isIOS, isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout) {
      setVisible(false);
    }
  }, [isMobileLayout]);

  return {
    visible,
    mode,
    enterFullscreen,
    dismiss,
  };
}

export default useFullscreenPrompt;
