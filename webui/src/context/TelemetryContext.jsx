// Telemetry Context Provider
// Purpose: Maintains shared telemetry snapshots and rover status streams for UI consumers. Scope: Subscribes to telemetry events and exposes normalized read APIs to components.
/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSocket } from './SocketContext.jsx';

const EMPTY_FRAMES = Object.freeze({});
const EMPTY_FRAME = null;

const TelemetryContext = createContext(null);

export function TelemetryProvider({ children }) {
  const socket = useSocket();
  const framesRef = useRef({});
  const roverSubscribersRef = useRef(new Map());
  const allSubscribersRef = useRef(new Set());

  const notifyRover = (roverId) => {
    const listeners = roverSubscribersRef.current.get(roverId);
    if (listeners) {
      listeners.forEach((listener) => listener());
    }
    allSubscribersRef.current.forEach((listener) => listener());
  };

  const store = useMemo(
    () => ({
      getFrames: () => framesRef.current,
      getFrame: (roverId) => {
        if (!roverId) return EMPTY_FRAME;
        return framesRef.current[roverId] ?? EMPTY_FRAME;
      },
      subscribeAll: (listener) => {
        allSubscribersRef.current.add(listener);
        return () => {
          allSubscribersRef.current.delete(listener);
        };
      },
      subscribeRover: (roverId, listener) => {
        if (!roverId) return () => {};
        let listeners = roverSubscribersRef.current.get(roverId);
        if (!listeners) {
          listeners = new Set();
          roverSubscribersRef.current.set(roverId, listeners);
        }
        listeners.add(listener);
        return () => {
          const current = roverSubscribersRef.current.get(roverId);
          if (!current) return;
          current.delete(listener);
          if (!current.size) {
            roverSubscribersRef.current.delete(roverId);
          }
        };
      },
    }),
    [],
  );

  useEffect(() => {
    function handleSensorFrame({ roverId, sensors = {}, frame = {} }) {
      if (!roverId) return;
      framesRef.current = {
        ...framesRef.current,
        [roverId]: {
          roverId,
          sensors,
          raw: frame?.data || null,
          receivedAt: Date.now(),
        },
      };
      notifyRover(roverId);
    }

    socket.on('sensorFrame', handleSensorFrame);
    return () => {
      socket.off('sensorFrame', handleSensorFrame);
    };
  }, [socket]);

  return <TelemetryContext.Provider value={store}>{children}</TelemetryContext.Provider>;
}

export function useTelemetryFrames() {
  const store = useContext(TelemetryContext);
  if (!store) {
    throw new Error('useTelemetryFrames must be used within TelemetryProvider');
  }
  return useSyncExternalStore(store.subscribeAll, store.getFrames, () => EMPTY_FRAMES);
}

export function useTelemetryFrame(roverId) {
  const store = useContext(TelemetryContext);
  if (!store) {
    throw new Error('useTelemetryFrame must be used within TelemetryProvider');
  }
  return useSyncExternalStore(
    (listener) => store.subscribeRover(roverId, listener),
    () => store.getFrame(roverId),
    () => EMPTY_FRAME,
  );
}
