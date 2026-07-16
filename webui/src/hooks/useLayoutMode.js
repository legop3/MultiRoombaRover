// Responsive Layout Mode Hook
// Purpose: Gives control-capable routes the same desktop, mobile-landscape,
// and mobile-portrait breakpoint policy.
// Scope: Classifies viewport geometry only; each route still owns its actual
// component arrangement so PTZ and rover controls can remain purpose-built.
import { useEffect, useState } from 'react';

function readLayoutMode() {
  if (typeof window === 'undefined') return 'desktop';
  if (window.innerWidth >= 1024) return 'desktop';
  return window.innerWidth > window.innerHeight ? 'mobile-landscape' : 'mobile-portrait';
}

export default function useLayoutMode() {
  const [mode, setMode] = useState(readLayoutMode);

  useEffect(() => {
    function updateMode() {
      /*
        Orientation changes are exposed as viewport resizes on the browsers
        supported by this UI. Reading both dimensions here keeps the route
        responsive without maintaining a second orientation event lifecycle.
      */
      setMode(readLayoutMode());
    }

    updateMode();
    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  return mode;
}
