import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function useSensorFeed() {
  const socket = useSocket();
  const [frames, setFrames] = useState({});

  useEffect(() => {
    function handleFrame({ roverId, sensors = {}, frame = {} }) {
      if (!roverId) return;
      setFrames((prev) => ({
        ...prev,
        [roverId]: {
          roverId,
          sensors,
          raw: frame?.data || null,
          receivedAt: Date.now(),
        },
      }));
    }

    socket.on('sensorFrame', handleFrame);
    return () => {
      socket.off('sensorFrame', handleFrame);
    };
  }, [socket]);

  return frames;
}
