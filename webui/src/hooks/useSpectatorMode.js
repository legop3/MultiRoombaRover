import { useEffect, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';

export function useSpectatorMode() {
  const { session, setRole, subscribeAll, connected } = useSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function ensureSpectator() {
      if (session?.mode === 'lockdown') {
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
  }, [connected, session?.mode, session?.role, setRole, subscribeAll]);

  return ready;
}
