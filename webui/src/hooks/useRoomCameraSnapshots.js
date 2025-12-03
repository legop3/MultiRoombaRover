import { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function useRoomCameraSnapshots(sourceList = []) {
  const socket = useSocket();
  const [feeds, setFeeds] = useState({});
  const objectUrls = useRef(new Map());
  const ids = useMemo(() => sourceList.map((e) => (typeof e === 'string' ? e : e.id)), [sourceList]);
  const idsKey = useMemo(() => ids.join('|'), [ids]);
  const idsRef = useRef([]);
  const retryTimer = useRef(null);

  useEffect(() => {
    idsRef.current = ids;
  }, [idsKey, ids]);

  useEffect(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    setFeeds({});
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, [idsKey]);

  useEffect(() => {
    if (!idsRef.current.length || !socket) {
      return undefined;
    }
    let cancelled = false;
    const currentIds = idsRef.current;

    const handleFrame = (meta = {}, buffer) => {
      if (cancelled || !meta.id || !buffer) return;
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const prevUrl = objectUrls.current.get(meta.id);
      if (prevUrl) {
        URL.revokeObjectURL(prevUrl);
      }
      objectUrls.current.set(meta.id, url);
      setFeeds((prev) => ({
        ...prev,
        [meta.id]: {
          status: 'playing',
          ts: meta.ts || Date.now(),
          error: null,
          objectUrl: url,
        },
      }));
    };

    const handleStatus = (meta = {}) => {
      if (cancelled || !meta.id) return;
      setFeeds((prev) => ({
        ...prev,
        [meta.id]: {
          ...(prev[meta.id] || {}),
          status: meta.error ? 'error' : prev[meta.id]?.status || 'connecting',
          error: meta.error || null,
          ts: meta.ts || prev[meta.id]?.ts || null,
          objectUrl: prev[meta.id]?.objectUrl || null,
        },
      }));
      if (meta.error && !cancelled) {
        scheduleRetry();
      }
    };

    const scheduleRetry = (delay = 5000) => {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
      }
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        if (!cancelled) {
          socket.emit('roomCamera:subscribe', { ids: currentIds }, (resp = {}) => {
            if (resp.error && !retryTimer.current) {
              scheduleRetry();
            }
          });
        }
      }, delay);
    };

    socket.on('roomCamera:frame', handleFrame);
    socket.on('roomCamera:status', handleStatus);

    socket.emit('roomCamera:subscribe', { ids: currentIds }, (resp = {}) => {
      if (resp.error) {
        scheduleRetry();
      }
    });

    return () => {
      cancelled = true;
      socket.emit('roomCamera:unsubscribe', { ids: currentIds });
      socket.off('roomCamera:frame', handleFrame);
      socket.off('roomCamera:status', handleStatus);
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [socket, idsKey]);

  return feeds;
}
