// Log Panel
// Purpose: Defines the Log Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useEffect, useMemo } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import CardFrame from '../CardFrame/index.jsx';

export default function LogPanel() {
  const socket = useSocket();
  const logs = useSessionSelector((state) => state.logs);
  const rendered = useMemo(() => logs.slice().reverse(), [logs]);

  useEffect(() => {
    const subscribe = () => {
      socket.emit('log:subscribe');
    };

    /*
      Server logs are noisy enough that receiving them globally can make normal
      driving views pay for a diagnostic tool they are not using. The panel owns
      the subscription because it is the visible consumer: when a route or tab
      unmounts this component, the server can stop sending log traffic to this
      browser entirely instead of merely hiding the rendered rows.

      The connect listener matters because Socket.IO rooms are attached to the
      current server-side socket instance. A reconnect gives the browser a fresh
      room membership, so the mounted panel must ask for the log room again.
    */
    subscribe();
    socket.on('connect', subscribe);

    return () => {
      /*
        Unsubscribing on unmount keeps inactive tab panels and non-log routes
        from continuing to receive high-volume log entries after the operator
        has navigated away from the diagnostic view.
      */
      socket.off('connect', subscribe);
      socket.emit('log:unsubscribe');
    };
  }, [socket]);

  return (
    <CardFrame title="Server logs" bodyClassName="space-y-0.5 text-base">
      <div className="surface h-64 overflow-y-auto font-mono text-xs">
        {logs.length === 0 ? (
          <p>No logs yet.</p>
        ) : (
          rendered.map((entry) => (
            <div key={entry.id} className="surface">
              <span className="text-amber-400">{entry.timestamp}</span>{' '}
              <span className="text-lime-400">[{entry.level}]</span>{' '}
              {entry.label && <span className="text-teal-400">[{entry.label}]</span>}{' '}
              <span>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </CardFrame>
  );
}
