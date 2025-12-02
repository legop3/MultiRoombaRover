import { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function useRoomCameraSnapshots(sourceList = []) {
  const socket = useSocket();
  const [feeds, setFeeds] = useState({});
  const objectUrls = useRef(new Map());
  const entriesKey = useMemo(() => sourceList.map((e) => (typeof e === 'string' ? e : e.id)).join('|'), [sourceList]);

  useEffect(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    setFeeds({});
  }, [entriesKey]);

  useEffect(() => {
    if (!sourceList.length || !socket) {
      return undefined;
    }
    let cancelled = false;

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
          stale: !!meta.stale,
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
          stale: meta.stale ?? prev[meta.id]?.stale ?? true,
          ts: meta.ts || prev[meta.id]?.ts || null,
          objectUrl: prev[meta.id]?.objectUrl || null,
        },
      }));
    };

    socket.on('roomCamera:frame', handleFrame);
    socket.on('roomCamera:status', handleStatus);

    socket.emit('roomCamera:subscribe', { ids: sourceList.map((e) => (typeof e === 'string' ? e : e.id)) });

    return () => {
      cancelled = true;
      socket.emit('roomCamera:unsubscribe', { ids: sourceList.map((e) => (typeof e === 'string' ? e : e.id)) });
      socket.off('roomCamera:frame', handleFrame);
      socket.off('roomCamera:status', handleStatus);
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
    };
  }, [socket, sourceList, entriesKey]);

  return feeds;
}
