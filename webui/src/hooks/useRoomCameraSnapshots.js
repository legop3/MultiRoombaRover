import { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

function normalizeCamera(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { id: entry, key: entry };
  }
  if (entry.id) {
    return { id: String(entry.id), key: entry.id };
  }
  return null;
}

function dedupe(entries = []) {
  const seen = new Set();
  const unique = [];
  entries.forEach((entry) => {
    if (!entry?.key || seen.has(entry.key)) return;
    seen.add(entry.key);
    unique.push(entry);
  });
  return unique.sort((a, b) => a.key.localeCompare(b.key));
}

export function useRoomCameraSnapshots(sourceList = []) {
  const socket = useSocket();
  const [feeds, setFeeds] = useState({});
  const objectUrls = useRef(new Map());
  const normalizedEntries = useMemo(() => dedupe(sourceList.map(normalizeCamera).filter(Boolean)), [sourceList]);
  const entriesKey = useMemo(() => normalizedEntries.map((e) => e.key).join('|'), [normalizedEntries]);

  useEffect(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    setFeeds({});
  }, [entriesKey]);

  useEffect(() => {
    if (!normalizedEntries.length || !socket) {
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

    normalizedEntries.forEach((entry) => {
      socket.emit('roomCamera:subscribe', { roomCameraId: entry.id }, (resp = {}) => {
        if (resp.error) {
          handleStatus({ id: entry.id, error: resp.error });
        } else {
          handleStatus({ id: entry.id, stale: true });
        }
      });
    });

    return () => {
      cancelled = true;
      normalizedEntries.forEach((entry) => {
        socket.emit('roomCamera:unsubscribe', { roomCameraId: entry.id });
      });
      socket.off('roomCamera:frame', handleFrame);
      socket.off('roomCamera:status', handleStatus);
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
    };
  }, [socket, normalizedEntries, entriesKey]);

  const filtered = useMemo(() => {
    if (!entriesKey) return {};
    const next = {};
    normalizedEntries.forEach((entry) => {
      if (feeds[entry.id]) {
        next[entry.id] = feeds[entry.id];
      }
    });
    return next;
  }, [feeds, entriesKey, normalizedEntries]);

  return filtered;
}
