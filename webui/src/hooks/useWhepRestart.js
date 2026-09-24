import { useCallback, useEffect, useRef, useState } from 'react';
import { RESTART_DELAY_MS } from '../components/RoverMediaPlayer/constants.js';

export default function useWhepRestart(enabled = true) {
  const timer = useRef(null);
  const enabledRef = useRef(enabled);
  const [restartToken, setRestartToken] = useState(0);
  const cancelRestart = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) cancelRestart();
  }, [enabled, cancelRestart]);
  const scheduleRestart = useCallback(() => {
    if (!enabledRef.current) return;
    cancelRestart();
    // Re-negotiate instead of reusing the failed PeerConnection. Callers that
    // own session requests also use this token to obtain fresh authorization.
    timer.current = setTimeout(() => {
      timer.current = null;
      setRestartToken(Date.now());
    }, RESTART_DELAY_MS);
  }, [cancelRestart]);
  useEffect(() => cancelRestart, [cancelRestart]);
  return { restartToken, scheduleRestart, cancelRestart };
}
