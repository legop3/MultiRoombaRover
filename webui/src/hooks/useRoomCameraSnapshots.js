import { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

const RETRY_DELAY_MS = 3000;

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
  const retryTimers = useRef(new Map());
  const entriesRef = useRef([]);

  useEffect(() => {
    entriesRef.current = normalizedEntries;
  }, [normalizedEntries]);

  useEffect(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    setFeeds({});
    retryTimers.current.forEach((timer) => clearTimeout(timer));
    retryTimers.current.clear();
  }, [entriesKey]);

  useEffect(() => {
    if (!entriesKey || !socket) {
      return undefined;
    }
    let cancelled = false;
    const entries = entriesRef.current;

    const clearRetry = (id) => {
      const timer = retryTimers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        retryTimers.current.delete(id);
      }
    };

    const scheduleRetry = (id) => {
      clearRetry(id);
      const timer = setTimeout(() => {
        retryTimers.current.delete(id);
        requestSubscribe(id);
      }, RETRY_DELAY_MS);
      retryTimers.current.set(id, timer);
    };

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

    const requestSubscribe = (id) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      socket.emit('roomCamera:subscribe', { roomCameraId: entry.id }, (resp = {}) => {
        if (resp.error) {
          handleStatus({ id: entry.id, error: resp.error });
          scheduleRetry(entry.id);
        } else {
          clearRetry(entry.id);
          handleStatus({ id: entry.id, stale: true });
        }
      });
    };

    socket.on('roomCamera:frame', handleFrame);
    socket.on('roomCamera:status', handleStatus);

    entries.forEach((entry) => requestSubscribe(entry.id));

    return () => {
      cancelled = true;
      entries.forEach((entry) => {
        socket.emit('roomCamera:unsubscribe', { roomCameraId: entry.id });
      });
      socket.off('roomCamera:frame', handleFrame);
      socket.off('roomCamera:status', handleStatus);
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
      retryTimers.current.forEach((timer) => clearTimeout(timer));
      retryTimers.current.clear();
    };
  }, [socket, entriesKey]);

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
