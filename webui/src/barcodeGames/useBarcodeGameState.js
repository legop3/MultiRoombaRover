// Barcode Game State Hook
// Purpose: Subscribes only interested pages/components to barcode game state.
// Scope: Keeps scanner-game traffic out of the global session tree so unrelated
// UI pages do not receive or retain barcode game data.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

const STATE_STALE_MS = 10 * 1000;
const RESUBSCRIBE_MS = 5 * 1000;

const EMPTY_BARCODE_GAME_STATE = {
  activeGameId: null,
  games: [],
  activeGame: null,
  participants: [],
  counters: {
    objects: [],
    rovers: [],
    codes: [],
  },
  recentEvents: [],
  ownPlayer: null,
};

function normalizeState(payload = {}) {
  return {
    ...EMPTY_BARCODE_GAME_STATE,
    ...(payload && typeof payload === 'object' ? payload : {}),
    games: Array.isArray(payload?.games) ? payload.games : [],
    participants: Array.isArray(payload?.participants) ? payload.participants : [],
    counters: {
      ...EMPTY_BARCODE_GAME_STATE.counters,
      ...(payload?.counters && typeof payload.counters === 'object' ? payload.counters : {}),
    },
    recentEvents: Array.isArray(payload?.recentEvents) ? payload.recentEvents : [],
  };
}

export default function useBarcodeGameState() {
  const socket = useSocket();
  const [state, setState] = useState(EMPTY_BARCODE_GAME_STATE);
  const [connectionState, setConnectionState] = useState({
    connected: Boolean(socket.connected),
    stale: true,
    lastReceivedAt: null,
  });

  useEffect(() => {
    let disposed = false;
    let staleTimer = null;
    let retryTimer = null;
    let lastReceivedAt = 0;

    function handleState(payload = {}) {
      if (disposed) return;
      lastReceivedAt = Date.now();
      setState(normalizeState(payload));
      setConnectionState({
        connected: Boolean(socket.connected),
        stale: false,
        lastReceivedAt,
      });
    }

    function subscribeToGameState() {
      // Socket.io rooms are server-side state, so a reconnect needs a fresh
      // subscribe packet. Retrying the same idempotent subscribe is cheap and
      // prevents the scanner page from getting stuck with old game text after a
      // transient Wi-Fi or server restart.
      socket.emit('barcodeGame:subscribe', {}, (response = {}) => {
        if (response.state) {
          handleState(response.state);
          return;
        }
        setConnectionState((previous) => ({
          ...previous,
          connected: Boolean(socket.connected),
          stale: !lastReceivedAt,
        }));
      });
    }

    function handleConnect() {
      setConnectionState((previous) => ({
        ...previous,
        connected: true,
        stale: !lastReceivedAt,
      }));
      subscribeToGameState();
    }

    function handleDisconnect() {
      setConnectionState((previous) => ({
        ...previous,
        connected: false,
        stale: true,
      }));
    }

    socket.on('barcodeGame:state', handleState);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    subscribeToGameState();

    staleTimer = window.setInterval(() => {
      const isStale = !lastReceivedAt || Date.now() - lastReceivedAt > STATE_STALE_MS;
      setConnectionState((previous) => ({
        ...previous,
        connected: Boolean(socket.connected),
        stale: isStale,
      }));
    }, 1000);

    retryTimer = window.setInterval(() => {
      if (!socket.connected) return;
      if (!lastReceivedAt || Date.now() - lastReceivedAt > STATE_STALE_MS) {
        subscribeToGameState();
      }
    }, RESUBSCRIBE_MS);

    return () => {
      disposed = true;
      window.clearInterval(staleTimer);
      window.clearInterval(retryTimer);
      socket.off('barcodeGame:state', handleState);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket]);

  const voteForGame = useCallback(
    (gameId) =>
      new Promise((resolve, reject) => {
        socket.emit('barcodeGame:vote', { gameId }, (response = {}) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          if (response.state) {
            setState(normalizeState(response.state));
          }
          resolve(response);
        });
      }),
    [socket],
  );

  return useMemo(
    () => ({
      state,
      connectionState,
      voteForGame,
    }),
    [connectionState, state, voteForGame],
  );
}
