import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSessionActions } from '../../context/SessionContext.jsx';

export default function OperatingModeRouteSync() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const { setOperatingMode, pushAlert } = useSessionActions();

  useEffect(() => {
    const leavingPtz = previousPath.current === '/ptz' && pathname !== '/ptz';
    previousPath.current = pathname;
    if (!leavingPtz) return;
    // Observe actual navigation rather than component cleanup, which also runs
    // during Strict Mode remounts. Entry remains gated by the PTZ request action.
    setOperatingMode('rover').catch((err) => {
      pushAlert({ title: 'Operating mode', message: err.message, color: '#f59e0b' });
    });
  }, [pathname, pushAlert, setOperatingMode]);

  return null;
}
