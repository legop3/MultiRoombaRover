// Hook: useSpectatorMode
// Purpose: Encapsulates spectator mode detection and toggle behavior for controls/UI gating. Scope: Derives spectator-specific flags from session and route state.
import { useEffect, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';

export function useSpectatorMode() {
  const { session, setRole, subscribeAll, connected } = useSession();
  const [ready, setReady] = useState(false);
  const canUseSpectatorAccess = session?.bandwidthSavings?.canUseExternalSpectatorAccess !== false;

  useEffect(() => {
    let cancelled = false;
    async function ensureSpectator() {
      if (session?.mode === 'lockdown') {
        setReady(false);
        return;
      }
      if (!canUseSpectatorAccess) {
        /*
          The server will reject the role change too, but stopping here prevents
          a blocked external spectator from retrying on every session sync while
          the page is intentionally waiting for an admin grant or config change.
        */
        setReady(false);
        return;
      }
      try {
        if (session?.role !== 'spectator') {
          await setRole('spectator');
        }
        await subscribeAll();
        if (!cancelled) {
          setReady(true);
        }
      } catch (err) {
        console.error('Failed to enter spectator mode', err);
        if (!cancelled) {
          setReady(false);
        }
      }
    }
    ensureSpectator();
    return () => {
      cancelled = true;
    };
  }, [canUseSpectatorAccess, connected, session?.mode, session?.role, setRole, subscribeAll]);

  return ready;
}
