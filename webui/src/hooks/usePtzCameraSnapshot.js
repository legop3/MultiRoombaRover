// Hook: usePtzCameraSnapshots
// Purpose: Subscribes to PTZ snapshot streams using the same map-shaped contract as rover snapshots.
// Scope: Keeps PTZ snapshot lifecycle boring: callers pass source ids and receive feeds keyed by id.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export const PTZ_CAMERA_ID = 'ptz-camera';

export function usePtzCameraSnapshots(sourceList = [], options = {}) {
  const socket = useSocket();
  const { enabled = true, version = null } = options;
  const [feeds, setFeeds] = useState({});
  const objectUrls = useRef(new Map());
  const ids = useMemo(
    () => sourceList.map((entry) => (typeof entry === 'string' ? entry : entry?.id)).filter(Boolean),
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
    if (!idsRef.current.length || !socket) return undefined;
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
          '[ptzSnapshot]',
          meta.id,
          `frame=${sizeBytes}B`,
          `avg=${Math.round(avgBytes)}B`,
          `count=${nextStats.count}`,
        );
        nextStats.lastLogAt = now;
      }
      statsRef.current.set(meta.id, nextStats);
      const url = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
      const prevUrl = objectUrls.current.get(meta.id);
      if (prevUrl) URL.revokeObjectURL(prevUrl);
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

    socket.on('ptzCamera:snapshotFrame', handleFrame);
    socket.on('ptzCamera:snapshotStatus', handleStatus);
    socket.emit('ptzCamera:snapshotSubscribe', { ids: currentIds }, () => {});

    return () => {
      cancelled = true;
      socket.emit('ptzCamera:snapshotUnsubscribe', { ids: currentIds });
      socket.off('ptzCamera:snapshotFrame', handleFrame);
      socket.off('ptzCamera:snapshotStatus', handleStatus);
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
    };
  }, [socket, idsKey, enabled, connectionNonce, debugSnapshots]);

  return feeds;
}

export function usePtzCameraSnapshot(options = {}) {
  /*
    This wrapper keeps older callers working while new PTZ UI uses the same
    keyed feed shape as useRoverSnapshots(). It should stay tiny so the real
    subscription behavior only has one implementation to maintain.
  */
  const feeds = usePtzCameraSnapshots([PTZ_CAMERA_ID], options);
  return feeds[PTZ_CAMERA_ID] || null;
}
