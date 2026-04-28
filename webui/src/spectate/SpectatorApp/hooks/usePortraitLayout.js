// Detect portrait-oriented viewport layout mode for spectator UI.
import { useEffect, useState } from 'react';

export default function usePortraitLayout() {
  const [isPortrait, setIsPortrait] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-aspect-ratio: 4/3)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-aspect-ratio: 4/3)');
    const handleChange = (event) => setIsPortrait(event.matches);
    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
    } else {
      media.addListener(handleChange);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', handleChange);
      } else {
        media.removeListener(handleChange);
      }
    };
  }, []);

  return isPortrait;
}
