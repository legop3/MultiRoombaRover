// Hook: useRoverSnapshots
// Purpose: Subscribes to rover snapshot streams and stores latest per-rover image states. Scope: Manages socket request/subscription lifecycle and data normalization.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function useRoverSnapshots(sourceList = [], options = {}) {
  const socket = useSocket();
  const { enabled = true, version = null } = options;
  const [feeds, setFeeds] = useState({});
  const objectUrls = useRef(new Map());
  const ids = useMemo(
    () => sourceList.map((e) => (typeof e === 'string' ? e : e.id)).filter(Boolean),
    [sourceList],
  );
  const idsKey = useMemo(() => {
    const base = ids.join('|');
    return version ? `${base}|v:${version}` : base;
  }, [ids, version]);
  const idsRef = useRef([]);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const statsRef = useRef(new Map());
  const debugSnapshots =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSnapshots');

  useEffect(() => {
    if (!socket) return undefined;
    const handleConnect = () => setConnectionNonce((prev) => prev + 1);
    socket.on('connect', handleConnect);
    return () => socket.off('connect', handleConnect);
  }, [socket]);

  useEffect(() => {
    idsRef.current = ids;
  }, [idsKey, ids]);

  useEffect(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    setFeeds({});
  }, [idsKey]);

  useEffect(() => {
    if (!enabled) {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
      setFeeds({});
      return undefined;
    }
    if (!idsRef.current.length || !socket) {
      return undefined;
    }
    let cancelled = false;
    const currentIds = idsRef.current;

    const handleFrame = (meta = {}, buffer) => {
      if (cancelled || !meta.id || !buffer) return;
      const sizeBytes = buffer.byteLength ?? buffer.length ?? 0;
      const now = Date.now();
      const prevStats = statsRef.current.get(meta.id) || {
        count: 0,
        totalBytes: 0,
        lastLogAt: 0,
      };
      const nextStats = {
        count: prevStats.count + 1,
        totalBytes: prevStats.totalBytes + sizeBytes,
        lastLogAt: prevStats.lastLogAt,
      };
      if (debugSnapshots && (!nextStats.lastLogAt || now - nextStats.lastLogAt >= 10000)) {
        const avgBytes = nextStats.count ? nextStats.totalBytes / nextStats.count : 0;
        console.log(
          '[roverSnapshot]',
          meta.id,
          `frame=${sizeBytes}B`,
          `avg=${Math.round(avgBytes)}B`,
          `count=${nextStats.count}`,
        );
        nextStats.lastLogAt = now;
      }
      statsRef.current.set(meta.id, nextStats);
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
    };

    socket.on('roverSnapshot:frame', handleFrame);
    socket.on('roverSnapshot:status', handleStatus);

    socket.emit('roverSnapshot:subscribe', { ids: currentIds }, (resp = {}) => {
      if (resp.error) return;
    });

    return () => {
      cancelled = true;
      socket.emit('roverSnapshot:unsubscribe', { ids: currentIds });
      socket.off('roverSnapshot:frame', handleFrame);
      socket.off('roverSnapshot:status', handleStatus);
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
    };
  }, [socket, idsKey, enabled, connectionNonce, debugSnapshots]);

  return feeds;
}
