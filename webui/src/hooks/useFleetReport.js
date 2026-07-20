// Fleet Report Hook
// Purpose: Provides one request lifecycle for compact and fullscreen read-only report surfaces.
// Scope: Owns socket acknowledgement handling and refresh state; presentation remains in report components.
import { useCallback, useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export default function useFleetReport({ since, until, compact = false, includeEvents = true, roverIds = null }) {
  const socket = useSocket();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    // Effects synchronize with the external Socket.IO connection. React state
    // changes occur only in the acknowledgement callback, avoiding a
    // synchronous state cascade merely because query inputs changed.
    socket.emit('fleetReports:get', {
      since,
      until,
      compact,
      includeEvents,
      roverIds,
      eventLimit: compact ? 100 : 1000,
    }, (response = {}) => {
      if (response.error || !response.report) {
        setError(response.error || 'Fleet report unavailable');
        setLoading(false);
        return;
      }
      setReport(response.report);
      setLoading(false);
    });
  }, [compact, includeEvents, refreshKey, roverIds, since, socket, until]);

  return { report, loading, error, refresh };
}
