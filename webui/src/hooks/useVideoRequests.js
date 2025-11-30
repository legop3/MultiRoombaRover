import { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

const RETRY_DELAY_MS = 3000;

function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const id = String(entry).trim();
    if (!id) return null;
    return { type: 'rover', id, key: id };
  }
  if (typeof entry === 'object') {
    if (entry.type && entry.id) {
      const id = String(entry.id);
      const audioId = entry.audioId ? String(entry.audioId) : null;
      let key = entry.key;
      if (!key) {
        key = entry.type === 'room' ? `room:${id}` : id;
      }
      return {
        type: entry.type,
        id,
        key,
        audioId,
      };
    }
    if (entry.roverId) {
      const id = String(entry.roverId);
      return { type: 'rover', id, key: entry.key || id };
    }
    if (entry.roomCameraId) {
      const id = String(entry.roomCameraId);
      return { type: 'room', id, key: entry.key || `room:${id}` };
    }
  }
  return null;
}

function dedupeEntries(entries = []) {
  const seen = new Set();
  const unique = [];
  entries.forEach((entry) => {
    if (!entry?.key || seen.has(entry.key)) {
      return;
    }
    seen.add(entry.key);
    unique.push(entry);
  });
  return unique.sort((a, b) => a.key.localeCompare(b.key));
}

export function useVideoRequests(sourceList = []) {
  const socket = useSocket();
  const [sources, setSources] = useState({});
  const normalizedEntries = useMemo(() => {
    if (!Array.isArray(sourceList)) {
      return [];
    }
    return dedupeEntries(sourceList.map(normalizeEntry).filter(Boolean));
  }, [sourceList]);
  const normalizedKey = useMemo(
    () => normalizedEntries.map((entry) => `${entry.type}:${entry.id}:${entry.key}`).join('|'),
    [normalizedEntries],
  );
  const entriesRef = useRef([]);
  const retryTimers = useRef(new Map());

  useEffect(() => {
    entriesRef.current = normalizedEntries;
  }, [normalizedEntries]);

  useEffect(() => {
    if (!normalizedKey) {
      return undefined;
    }
    const entries = entriesRef.current;
    let cancelled = false;
    const timers = retryTimers.current;

    function clearRetry(key) {
      const timer = timers.get(key);
      if (timer) {
        clearTimeout(timer);
        timers.delete(key);
      }
    }

    function scheduleRetry(entry) {
      clearRetry(entry.key);
      const timer = setTimeout(() => {
        timers.delete(entry.key);
        if (cancelled) return;
        requestEntry(entry);
      }, RETRY_DELAY_MS);
      timers.set(entry.key, timer);
    }

    function requestEntry(entry) {
      const payload = entry.type === 'room' ? { roomCameraId: entry.id } : { roverId: entry.id };
      socket.emit('video:request', payload, (resp = {}) => {
        if (cancelled) return;
        if (!resp || resp.error || !resp.url || !resp.token) {
          // eslint-disable-next-line no-console
          console.warn('video:request failed', { entry, resp });
          scheduleRetry(entry);
          setSources((prev) => ({
            ...prev,
            [entry.key]: resp,
          }));
          return;
        }
        clearRetry(entry.key);
        setSources((prev) => {
          const next = { ...prev, [entry.key]: resp };
          if (entry.audioId && resp.url && resp.token) {
            const audioUrl = resp.url.replace(
              `/${encodeURIComponent(entry.id)}/whep`,
              `/${encodeURIComponent(entry.audioId)}/whep`,
            );
            next[entry.audioId] = { url: audioUrl, token: resp.token };
          }
          return next;
        });
      });
    }

    entries.forEach((entry) => {
      clearRetry(entry.key);
      requestEntry(entry);
    });

    return () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, [socket, normalizedKey]);

  const filtered = useMemo(() => {
    if (!normalizedKey) return {};
    const next = {};
    normalizedEntries.forEach((entry) => {
      if (sources[entry.key]) {
        next[entry.key] = sources[entry.key];
      }
      if (entry.audioId && sources[entry.audioId]) {
        next[entry.audioId] = sources[entry.audioId];
      }
    });
    return next;
  }, [normalizedKey, sources, normalizedEntries]);

  return filtered;
}
