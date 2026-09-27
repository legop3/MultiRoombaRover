import { useCallback, useEffect, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';

export default function usePtzSession() {
  const connected = useSessionSelector((state) => state.connected);
  const socketId = useSessionSelector((state) => state.session?.socketId);
  const canEnter = useSessionSelector((state) => Boolean(state.session?.ptzCamera?.permissions?.canEnter));
  const { setOperatingMode, ptzRequestTurn } = useSessionActions();
  const [entryError, setEntryError] = useState(null);
  const enter = useCallback(async () => {
    await setOperatingMode('ptz');
    await ptzRequestTurn();
  }, [setOperatingMode, ptzRequestTurn]);

  useEffect(() => {
    if (!connected || !socketId || !canEnter) return;
    let active = true;
    // Entry happens on route mount/reconnect, not on queue changes. Releasing a
    // turn therefore leaves the page idle instead of silently requesting again.
    // Both server actions are serialized and idempotent under Strict Mode.
    (async () => {
      await setOperatingMode('ptz');
      if (active) await ptzRequestTurn();
    })().then(() => {
      if (active) setEntryError(null);
    }).catch((err) => {
      if (active) setEntryError(err.message);
    });
    return () => { active = false; };
  }, [connected, socketId, canEnter, setOperatingMode, ptzRequestTurn]);

  const retryEntry = useCallback(() => {
    enter().then(() => setEntryError(null)).catch((err) => setEntryError(err.message));
  }, [enter]);
  return { entryError, retryEntry };
}
