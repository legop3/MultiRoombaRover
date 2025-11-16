import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function useVideoRequests(roverIds = []) {
  const socket = useSocket();
  const [sources, setSources] = useState({});
  const normalizedKey = Array.isArray(roverIds) ? roverIds.filter(Boolean).join('|') : '';

  useEffect(() => {
    if (!normalizedKey) {
      return undefined;
    }
    const ids = normalizedKey.split('|');
    let cancelled = false;
    ids.forEach((roverId) => {
      socket.emit('video:request', { roverId }, (resp = {}) => {
        if (cancelled) return;
        setSources((prev) => ({
          ...prev,
          [roverId]: resp,
        }));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [socket, normalizedKey]);

  const filtered = useMemo(() => {
    if (!normalizedKey) return {};
    const ids = normalizedKey.split('|');
    const next = {};
    ids.forEach((id) => {
      if (sources[id]) {
        next[id] = sources[id];
      }
    });
    return next;
  }, [normalizedKey, sources]);

  return filtered;
}
