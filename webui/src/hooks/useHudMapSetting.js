import { useEffect, useState } from 'react';

export function useHudMapSetting() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('hudMapDesktop') === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('hudMapDesktop', enabled ? '1' : '0');
    const event = new CustomEvent('hudMapDesktopChanged', { detail: enabled });
    window.dispatchEvent(event);
  }, [enabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (event) => {
      if (typeof event.detail === 'boolean') {
        setEnabled(event.detail);
      }
    };
    window.addEventListener('hudMapDesktopChanged', handler);
    return () => window.removeEventListener('hudMapDesktopChanged', handler);
  }, []);

  return [enabled, setEnabled];
}
