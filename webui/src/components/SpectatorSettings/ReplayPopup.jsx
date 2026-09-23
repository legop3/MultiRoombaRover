// Shared spectator replay handling keeps disabled pages from retaining old popups.
import { useEffect } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import ReplayReadyPopup from '../ReplaySourcesPanel/ReplayReadyPopup.jsx';

export default function SpectatorReplayPopup({ enabled, ready }) {
  const replay = useSessionSelector((state) => state.latestReplay);
  const { clearLatestReplay } = useSessionActions();

  useEffect(() => {
    // Consume arrivals while disabled so enabling popups only shows future replays.
    if (ready && !enabled && replay) clearLatestReplay();
  }, [ready, enabled, replay, clearLatestReplay]);

  return ready && enabled ? <ReplayReadyPopup replay={replay} onClose={clearLatestReplay} /> : null;
}
