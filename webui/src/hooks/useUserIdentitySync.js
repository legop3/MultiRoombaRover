// Hook: useUserIdentitySync
// Purpose: Keeps local identity state synchronized with server session/auth updates. Scope: Handles identity hydration, change propagation, and persistence touch points.
import { useCallback, useEffect, useRef } from 'react';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { getBrowserFingerprintId } from '../lib/browserFingerprint.js';
import { useSettingsNamespace } from '../settings/index.js';

export default function useUserIdentitySync({ identitySurface = 'passive' } = {}) {
  const socket = useSocket();
  const connected = useSessionSelector((state) => state.connected);
  const { identifySession } = useSessionActions();
  const { value: identity, status: identityStatus, save: saveIdentity } = useSettingsNamespace('identity', {
    cookieUserId: '',
  });
  const { value: profile, status: profileStatus } = useSettingsNamespace('profile', { nickname: '' });
  const { value: overseerPreference, status: overseerPreferenceStatus } = useSettingsNamespace(
    'overseerPreference',
    { enabled: false },
  );

  const lastAckSocketRef = useRef(null);
  const fingerprintRef = useRef('');

  const ready =
    identityStatus === 'ready' && profileStatus === 'ready' && overseerPreferenceStatus === 'ready';
  const cookieUserId = (identity?.cookieUserId || '').trim();
  const nickname = (profile?.nickname || '').trim();
  const overseerEnabled = Boolean(overseerPreference?.enabled);
  const normalizedIdentitySurface = identitySurface === 'driver' ? 'driver' : 'passive';

  const sendIdentify = useCallback(async () => {
    if (!ready || !connected || !socket?.id) return;
    try {
      if (!fingerprintRef.current) {
        /*
          The portable cookie key is still the cross-device identity signal.
          Thumbmark adds a same-device signal that survives cookie clearing, so
          both are sent together whenever the heartbeat identifies this socket.
        */
        fingerprintRef.current = await getBrowserFingerprintId();
      }
      /*
        Every route shares the same persisted identity key, but only the main
        driver page should trigger duplicate-tab prevention. Sending the surface
        with the heartbeat lets the server make that decision before spectator
        pages finish their role switch.
      */
      const resp = await identifySession({
        cookieUserId,
        fingerprintId: fingerprintRef.current,
        nickname,
        overseerEnabled,
        identitySurface: normalizedIdentitySurface,
      });
      const nextKey = (resp?.cookieUserId || '').trim();
      if (nextKey && nextKey !== cookieUserId) {
        saveIdentity((current) => ({ ...(current || {}), cookieUserId: nextKey }));
      }
      lastAckSocketRef.current = socket.id;
    } catch {
      /*
        The permanent heartbeat below is the retry mechanism. A failed or
        half-open request must not create separate timer state that can stop
        future identity sends or disappear during a socket transition.
      */
    }
  }, [
    connected,
    cookieUserId,
    identifySession,
    normalizedIdentitySurface,
    nickname,
    overseerEnabled,
    ready,
    saveIdentity,
    socket,
  ]);

  useEffect(() => {
    if (!ready || !connected || !socket?.id) return;
    if (lastAckSocketRef.current === socket.id) return;
    sendIdentify();
  }, [connected, ready, sendIdentify, socket?.id]);

  useEffect(() => {
    if (!ready || !connected || !socket?.id) return;
    sendIdentify();
  }, [ready, connected, socket?.id, cookieUserId, nickname, overseerEnabled, normalizedIdentitySurface, sendIdentify]);

  useEffect(() => {
    const handleOnline = () => {
      if (!socket?.connected) return;
      sendIdentify();
    };
    const handleVisibility = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      if (!socket?.connected) return;
      sendIdentify();
    };
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [sendIdentify, socket?.connected]);

  useEffect(() => {
    /*
      Keep this interval installed whenever persisted identity settings are
      ready, including while Socket.IO is reconnecting. Each tick checks the
      current connection before sending, so reconnects resume heartbeats without
      depending on an acknowledgement or another effect recreating the timer.
    */
    if (!ready) return undefined;
    const timer = setInterval(() => {
      if (!socket?.connected) return;
      sendIdentify();
    }, 2000);
    return () => clearInterval(timer);
  }, [ready, sendIdentify, socket]);
}
