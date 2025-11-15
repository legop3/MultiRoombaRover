import { useEffect, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';

export function useSpectatorMode() {
  const { session, setRole, subscribeAll } = useSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function ensureSpectator() {
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
      }
    }
    ensureSpectator();
    return () => {
      cancelled = true;
    };
  }, [session?.role, setRole, subscribeAll]);

  return ready;
}
