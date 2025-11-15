import { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { useSocket } from './SocketContext.jsx';

const TelemetryContext = createContext({ frames: {} });

export function TelemetryProvider({ children }) {
  const socket = useSocket();
  const [frames, setFrames] = useState({});

  useEffect(() => {
    function handleSensorFrame({ roverId, sensors = {}, frame = {} }) {
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

    socket.on('sensorFrame', handleSensorFrame);
    return () => {
      socket.off('sensorFrame', handleSensorFrame);
    };
  }, [socket]);

  const value = useMemo(() => ({ frames }), [frames]);
  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetryFrames() {
  return useContext(TelemetryContext).frames;
}

export function useTelemetryFrame(roverId) {
  const frames = useTelemetryFrames();
  if (!roverId) return null;
  return frames[roverId] ?? null;
}
