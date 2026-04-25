import { useCallback, useEffect, useRef } from 'react';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';

export default function useUserIdentitySync() {
  const socket = useSocket();
  const connected = useSessionSelector((state) => state.connected);
  const { identifySession } = useSessionActions();
  const { value: identity, status: identityStatus, save: saveIdentity } = useSettingsNamespace('identity', {
    cookieUserId: '',
  });
  const { value: profile, status: profileStatus } = useSettingsNamespace('profile', { nickname: '' });

  const inFlightRef = useRef(false);
  const lastAckSocketRef = useRef(null);
  const retryTimerRef = useRef(null);

  const ready = identityStatus === 'ready' && profileStatus === 'ready';
  const cookieUserId = (identity?.cookieUserId || '').trim();
  const nickname = (profile?.nickname || '').trim();

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const sendIdentify = useCallback(async () => {
    if (!ready || !connected || !socket?.id || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const resp = await identifySession({ cookieUserId, nickname });
      const nextKey = (resp?.cookieUserId || '').trim();
      if (nextKey && nextKey !== cookieUserId) {
        saveIdentity((current) => ({ ...(current || {}), cookieUserId: nextKey }));
      }
      lastAckSocketRef.current = socket.id;
      clearRetry();
    } catch {
      clearRetry();
      retryTimerRef.current = setTimeout(() => {
        sendIdentify();
      }, 2000);
    } finally {
      inFlightRef.current = false;
    }
  }, [clearRetry, connected, cookieUserId, identifySession, nickname, ready, saveIdentity, socket?.id]);

  useEffect(() => {
    if (!ready || !connected || !socket?.id) return;
    if (lastAckSocketRef.current === socket.id) return;
    sendIdentify();
  }, [connected, ready, sendIdentify, socket?.id]);

  useEffect(() => {
    if (!ready || !connected || !socket?.id) return;
    sendIdentify();
  }, [ready, connected, socket?.id, cookieUserId, nickname, sendIdentify]);

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

  useEffect(() => () => clearRetry(), [clearRetry]);
}
