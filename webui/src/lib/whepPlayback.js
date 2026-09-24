import { WhepPlayer } from './whepPlayer.js';

const TERMINAL_STATES = ['error', 'failed', 'disconnected', 'closed'];

// A mounted effect owns exactly one connection. Invalidate its callbacks before
// stopping it so a late rejection or cleanup status cannot restart old media.
export function startWhepPlayback({ onStatus, onError, scheduleRestart, terminalStates = TERMINAL_STATES, ...options }) {
  let active = true;
  const player = new WhepPlayer({
    ...options,
    onStatus: (status, detail) => {
      if (!active) return;
      onStatus(status, detail);
      if (terminalStates.includes(String(status || '').toLowerCase())) scheduleRestart();
    },
  });
  player.start().catch((error) => {
    if (!active) return;
    onError(error);
    scheduleRestart();
  });
  return () => {
    active = false;
    player.stop();
  };
}
