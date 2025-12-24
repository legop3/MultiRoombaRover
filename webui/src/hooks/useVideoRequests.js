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
      let key = entry.key;
      if (!key) {
        key = entry.type === 'room' ? `room:${id}` : id;
      }
      return {
        type: entry.type,
        id,
        key,
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

export function useVideoRequests(sourceList = [], options = {}) {
  const socket = useSocket();
  const { enabled = true, version = null } = options;
  const [sources, setSources] = useState({});
  const normalizedEntries = useMemo(() => {
    if (!Array.isArray(sourceList)) {
      return [];
    }
    return dedupeEntries(sourceList.map(normalizeEntry).filter(Boolean));
  }, [sourceList]);
  const normalizedKey = useMemo(() => {
    const base = normalizedEntries.map((entry) => `${entry.type}:${entry.id}:${entry.key}`).join('|');
    return version ? `${base}|v:${version}` : base;
  }, [normalizedEntries, version]);
  const entriesRef = useRef([]);
  const [connectionNonce, setConnectionNonce] = useState(0);

  useEffect(() => {
    if (!socket) return undefined;
    const handleConnect = () => setConnectionNonce((prev) => prev + 1);
    socket.on('connect', handleConnect);
    return () => {
      socket.off('connect', handleConnect);
    };
  }, [socket]);

  useEffect(() => {
    entriesRef.current = normalizedEntries;
  }, [normalizedEntries]);

  useEffect(() => {
    if (!normalizedKey || !enabled) {
      setSources({});
      return undefined;
    }
    const entries = entriesRef.current;
    let cancelled = false;

    function requestEntry(entry) {
      const payload = entry.type === 'room' ? { roomCameraId: entry.id } : { roverId: entry.id };
      socket.emit('video:request', payload, (resp = {}) => {
        if (cancelled) return;
        setSources((prev) => ({ ...prev, [entry.key]: resp }));
      });
    }

    entries.forEach((entry) => {
      requestEntry(entry);
    });

    return () => {
      cancelled = true;
    };
  }, [socket, normalizedKey, enabled, connectionNonce]);

  const filtered = useMemo(() => {
    if (!normalizedKey || !enabled) return {};
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
