// Hook: useIncomingInterInstanceTransfer
// Purpose: Applies settings transferred through an inter-instance URL before the normal identity heartbeat runs.
// Scope: Owns only inbound URL parameters; requesting the target rover is handled after socket/session state is ready.
import { useEffect, useRef } from 'react';
import { useSettings } from '../settings/index.js';
import { base64UrlDecodeJson } from '../lib/interInstanceTransfer.js';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';

export default function useIncomingInterInstanceTransfer() {
  const settings = useSettings();
  const { requestControl } = useSessionActions();
  const connected = useSessionSelector((state) => state.connected);
  const appliedRef = useRef(false);
  const requestedRef = useRef(false);
  const roverIdRef = useRef('');

  useEffect(() => {
    if (appliedRef.current || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const transfer = url.searchParams.get('settingsTransfer');
    roverIdRef.current = String(url.searchParams.get('rover') || '').trim();
    if (!transfer) {
      appliedRef.current = true;
      return;
    }
    try {
      /*
        The source page only adds settingsTransfer when its saved Page setting
        allows it. A present transfer param is therefore an explicit instruction
        to replace the local settings cookie without asking again here.
      */
      const nextSettings = base64UrlDecodeJson(transfer);
      settings.saveAll(nextSettings && typeof nextSettings === 'object' ? nextSettings : {});
      url.searchParams.delete('settingsTransfer');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (error) {
      // A bad transfer payload should not block the page or the rover request.
      console.warn('Failed to apply transferred inter-instance settings', error);
    } finally {
      appliedRef.current = true;
    }
  }, [settings]);

  useEffect(() => {
    if (!appliedRef.current || requestedRef.current || !connected) return;
    const roverId = roverIdRef.current;
    if (!roverId) return;
    requestedRef.current = true;
    /*
      The identity heartbeat reacts to the settings overwrite through the shared
      settings context. Waiting for a connected socket here keeps this hook from
      racing the initial Socket.IO connection while still using the existing
      request-control path.
    */
    requestControl(roverId).catch((error) => {
      requestedRef.current = false;
      console.warn('Failed to request transferred inter-instance rover', error);
    });
  }, [connected, requestControl]);
}
