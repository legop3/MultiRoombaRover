import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function useVideoRequests(roverIds = []) {
  const socket = useSocket();
  const [sources, setSources] = useState({});

  useEffect(() => {
    const ids = Array.from(new Set(roverIds.filter(Boolean)));
    if (!ids.length) return;
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
  }, [socket, roverIds.join('|')]);

  return sources;
}
