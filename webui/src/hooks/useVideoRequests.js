import { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

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
      return { type: entry.type, id, key: entry.key || `${entry.type}:${id}` };
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

  useEffect(() => {
    entriesRef.current = normalizedEntries;
  }, [normalizedEntries]);

  useEffect(() => {
    if (!normalizedKey) {
      return undefined;
    }
    const entries = entriesRef.current;
    let cancelled = false;
    entries.forEach((entry) => {
      const payload = entry.type === 'room' ? { roomCameraId: entry.id } : { roverId: entry.id };
      socket.emit('video:request', payload, (resp = {}) => {
        if (cancelled) return;
        setSources((prev) => ({
          ...prev,
          [entry.key]: resp,
        }));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [socket, normalizedKey]);

  const filtered = useMemo(() => {
    if (!normalizedKey) return {};
    const next = {};
    normalizedEntries.forEach((entry) => {
      if (sources[entry.key]) {
        next[entry.key] = sources[entry.key];
      }
    });
    return next;
  }, [normalizedKey, sources, normalizedEntries]);

  return filtered;
}
