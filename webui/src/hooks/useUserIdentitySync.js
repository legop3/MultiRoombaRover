// Hook: useUserIdentitySync
// Purpose: Keeps local identity state synchronized with server session/auth updates. Scope: Handles identity hydration, change propagation, and persistence touch points.
import { useCallback, useEffect } from 'react';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { getBrowserFingerprintId } from '../lib/browserFingerprint.js';
import { useSettingsNamespace } from '../settings/index.js';

export default function useUserIdentitySync({ identitySurface = 'passive' } = {}) {
  const socket = useSocket();
  const connected = useSessionSelector((state) => state.connected);
  const serverCookieUserId = useSessionSelector((state) => state.session?.identity?.cookieUserId || '');
  const { identifySession } = useSessionActions();
  const { value: identity, status: identityStatus, save: saveIdentity } = useSettingsNamespace('identity', {
    cookieUserId: '',
  });
  const { value: profile, status: profileStatus } = useSettingsNamespace('profile', { nickname: '' });
  const { value: overseerPreference, status: overseerPreferenceStatus } = useSettingsNamespace(
    'overseerPreference',
    { enabled: false },
  );
  const { value: audioAdjustments, status: audioAdjustmentsStatus } = useSettingsNamespace('audioAdjustments', {
    hornPercent: 0,
    ttsPercent: 0,
    forwardPercent: 0,
  });

  const ready =
    identityStatus === 'ready'
    && profileStatus === 'ready'
    && overseerPreferenceStatus === 'ready'
    && audioAdjustmentsStatus === 'ready';
  const cookieUserId = (identity?.cookieUserId || '').trim();
  const nickname = (profile?.nickname || '').trim();
  const overseerEnabled = Boolean(overseerPreference?.enabled);
  const normalizedIdentitySurface = identitySurface === 'driver' ? 'driver' : 'passive';

  const sendIdentify = useCallback(async () => {
    if (!ready || !connected || !socket?.id) return;
    try {
      /*
        Handshake auth establishes identity before connection handlers run.
        This event remains the live-update path for settings that change while
        the current transport stays connected, so existing callers and server
        behavior do not need a second update contract.
      */
      const resp = await identifySession({
        cookieUserId,
        fingerprintId: await getBrowserFingerprintId(),
        nickname,
        audioAdjustments,
        overseerEnabled,
        identitySurface: normalizedIdentitySurface,
      });
      const nextKey = (resp?.cookieUserId || '').trim();
      if (nextKey && nextKey !== cookieUserId) {
        saveIdentity((current) => ({ ...(current || {}), cookieUserId: nextKey }));
      }
    } catch {
      /*
        A failed live update must not replace Socket.IO's connection lifecycle
        with custom retry state. The next reconnect reads the latest persisted
        settings through handshake auth and re-establishes the complete identity.
      */
    }
  }, [
    audioAdjustments,
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
    /*
      This runs once when the route's settings become ready and again only when
      an identity value changes. Reconnects receive the same data from the auth
      callback, so there is intentionally no timer, visibility retry, or online
      retry here.
    */
    if (!ready || !connected || !socket?.id) return;
    sendIdentify();
  }, [ready, connected, socket?.id, cookieUserId, nickname, audioAdjustments, overseerEnabled, normalizedIdentitySurface, sendIdentify]);

  useEffect(() => {
    /*
      A first-time browser has no portable key to send in its handshake, so the
      canonical identity service creates one. Session sync is authoritative for
      that generated value; persisting it here makes every later handshake carry
      the same user key without depending on a session:identify acknowledgement.
    */
    const nextKey = String(serverCookieUserId || '').trim();
    if (!nextKey || nextKey === cookieUserId) return;
    saveIdentity((current) => ({ ...(current || {}), cookieUserId: nextKey }));
  }, [cookieUserId, saveIdentity, serverCookieUserId]);
}
