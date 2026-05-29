import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';

const CONNECTED_FADE_DELAY_MS = 4000;

function cls(...values) {
  return values.filter(Boolean).join(' ');
}

export default function SocketConnectionPill() {
  const socket = useSocket();
  const [connected, setConnected] = useState(Boolean(socket?.connected));
  const [lastReason, setLastReason] = useState('');
  const [visible, setVisible] = useState(true);
  const [faded, setFaded] = useState(false);
  const fadeTimerRef = useRef(null);

  useEffect(() => {
    const clearFadeTimer = () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };

    const show = () => {
      clearFadeTimer();
      setVisible(true);
      setFaded(false);
    };

    const scheduleFade = () => {
      clearFadeTimer();
      fadeTimerRef.current = setTimeout(() => {
        setFaded(true);
      }, CONNECTED_FADE_DELAY_MS);
    };

    const onConnect = () => {
      setConnected(true);
      setLastReason('');
      show();
      scheduleFade();
    };

    const onDisconnect = (reason) => {
      setConnected(false);
      setLastReason(typeof reason === 'string' ? reason : 'disconnected');
      show();
    };

    const onConnectError = (err) => {
      setConnected(false);
      setLastReason(err?.message || 'connect error');
      show();
    };

    const onReconnectAttempt = () => {
      setConnected(false);
      show();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.io.on('reconnect_attempt', onReconnectAttempt);

    if (socket.connected) {
      scheduleFade();
    }

    return () => {
      clearFadeTimer();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
    };
  }, [socket]);

  const offline = typeof navigator !== 'undefined' ? navigator.onLine === false : false;
  const statusLabel = connected
    ? 'Connected to socket.io'
    : offline
      ? 'Offline'
      : 'Reconnecting...';
  const detail = connected ? '' : lastReason;

  const toneClass = connected
    ? 'bg-emerald-700 text-emerald-100'
    : offline
      ? 'bg-red-800 text-red-100'
      : 'bg-amber-800 text-amber-100';

  return (
    <div
      className={cls(
        'fixed bottom-2 left-2 z-[120] transition-opacity duration-500',
        !visible && 'hidden',
        faded ? 'opacity-0 pointer-events-none' : 'opacity-100',
      )}
      aria-live="polite"
    >
      <div className={cls('rounded-sm px-2 py-1 text-xs', toneClass)}>
        <span className="font-semibold">{statusLabel}</span>
        {detail ? <span className="ml-1 opacity-85">({detail})</span> : null}
      </div>
    </div>
  );
}
