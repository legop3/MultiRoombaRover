import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function useVideoRequests(roverIds = []) {
  const socket = useSocket();
  const [sources, setSources] = useState({});
  const ids = useMemo(() => Array.from(new Set(roverIds.filter(Boolean))), [roverIds]);
  const idsKey = ids.join('|');

  useEffect(() => {
    if (!ids.length) {
      return undefined;
    }
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
  }, [socket, idsKey, ids]);
  const filtered = useMemo(() => {
    if (!ids.length) return {};
    const next = {};
    ids.forEach((id) => {
      if (sources[id]) {
        next[id] = sources[id];
      }
    });
    return next;
  }, [ids, sources]);

  return filtered;
}
