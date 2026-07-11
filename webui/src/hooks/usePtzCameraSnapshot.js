// Hook: usePtzCameraSnapshot
// Purpose: Subscribes to the server-generated PTZ camera snapshot feed.
// Scope: Mirrors the rover snapshot object-URL lifecycle while using PTZ-specific socket events and authorization.
import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function usePtzCameraSnapshot(options = {}) {
  const socket = useSocket();
  const { enabled = true, version = null } = options;
  const [feed, setFeed] = useState(null);
  const objectUrlRef = useRef(null);
  const [connectionNonce, setConnectionNonce] = useState(0);

  useEffect(() => {
    if (!socket) return undefined;
    const handleConnect = () => setConnectionNonce((prev) => prev + 1);
    socket.on('connect', handleConnect);
    return () => socket.off('connect', handleConnect);
  }, [socket]);

  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setFeed(null);
  }, [version]);

  useEffect(() => {
    if (!enabled || !socket) return undefined;
    let cancelled = false;

    const handleFrame = (meta = {}, buffer) => {
      if (cancelled || !buffer) return;
      const url = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setFeed({
        status: 'playing',
        ts: meta.ts || Date.now(),
        error: null,
        objectUrl: url,
      });
    };

    const handleStatus = (meta = {}) => {
      if (cancelled) return;
      setFeed((prev) => ({
        ...(prev || {}),
        status: meta.error ? 'error' : prev?.status || 'connecting',
        error: meta.error || null,
        ts: meta.ts || prev?.ts || null,
        objectUrl: prev?.objectUrl || null,
      }));
    };

    socket.on('ptzCamera:snapshotFrame', handleFrame);
    socket.on('ptzCamera:snapshotStatus', handleStatus);
    socket.emit('ptzCamera:snapshotSubscribe', {}, () => {});

    return () => {
      cancelled = true;
      socket.emit('ptzCamera:snapshotUnsubscribe');
      socket.off('ptzCamera:snapshotFrame', handleFrame);
      socket.off('ptzCamera:snapshotStatus', handleStatus);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [socket, enabled, version, connectionNonce]);

  return feed;
}
