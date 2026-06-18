// Barcode Game State Hook
// Purpose: Subscribes only interested pages/components to barcode game state.
// Scope: Keeps scanner-game traffic out of the global session tree so unrelated
// UI pages do not receive or retain barcode game data.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

const EMPTY_BARCODE_GAME_STATE = {
  activeGameId: null,
  games: [],
  activeGame: null,
  counters: {
    objects: [],
    rovers: [],
    codes: [],
  },
  recentEvents: [],
};

function normalizeState(payload = {}) {
  return {
    ...EMPTY_BARCODE_GAME_STATE,
    ...(payload && typeof payload === 'object' ? payload : {}),
    games: Array.isArray(payload?.games) ? payload.games : [],
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

  useEffect(() => {
    function handleState(payload = {}) {
      setState(normalizeState(payload));
    }

    socket.emit('barcodeGame:subscribe', {}, (response = {}) => {
      if (response.state) {
        handleState(response.state);
      }
    });
    socket.on('barcodeGame:state', handleState);
    return () => {
      socket.off('barcodeGame:state', handleState);
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
      voteForGame,
    }),
    [state, voteForGame],
  );
}
