import { useMemo } from 'react';
import { useSessionSelector } from '../context/SessionContext.jsx';
import { useSharedClock } from './useSharedClock.js';

export function useDriverVideoModePolicy(roverId) {
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const turnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const activeDrivers = useSessionSelector((state) => state.session?.activeDrivers ?? {});
  const nonTurnSnapshotsActive = useSessionSelector(
    (state) => Boolean(state.session?.bandwidthSavings?.nonTurnVideo?.snapshotsActive),
  );
  const isTurnsMode = mode === 'turns';
  /*
    This policy only switches preview/full video around a multi-second turn
    boundary. A shared one-second clock is responsive enough for that UI policy
    and avoids running a separate 250ms timer beside the TurnsOverlay countdown.
  */
  const now = useSharedClock(1000, isTurnsMode);

  const turnInfo = roverId ? turnQueues?.[roverId] || null : null;
  const activeDriverId = roverId ? activeDrivers?.[roverId] || null : null;
  const isActiveDriver = Boolean(socketId && activeDriverId === socketId);
  const nextDriverId = useMemo(() => {
    const queue = turnInfo?.queue || [];
    if (!queue.length || !turnInfo?.current || queue.length <= 1) return null;
    const idx = queue.findIndex((id) => id === turnInfo.current);
    if (idx === -1) return queue[0] || null;
    return queue[(idx + 1) % queue.length] || null;
  }, [turnInfo]);
  const isNextDriver = Boolean(socketId && nextDriverId === socketId);
  const deadline = turnInfo?.deadline || null;
  const msUntilTurn = deadline ? deadline - now : null;
  /*
    The server evaluates the global controllable-user threshold because that
    same decision is enforced in socket video tokens and MediaMTX auth. This
    hook only mirrors the active result so the browser does not request live
    video when snapshots are already the authoritative non-turn outcome.
  */
  const shouldUsePreviewByLoad = nonTurnSnapshotsActive && isTurnsMode;
  const isPreSwitchWindow =
    isTurnsMode && isNextDriver && msUntilTurn != null && msUntilTurn <= 5000 && msUntilTurn > 0;
  const showNotTurnNotice = isTurnsMode && !isActiveDriver;
  const forceSnapshotByTurnPolicy = showNotTurnNotice && !isPreSwitchWindow && shouldUsePreviewByLoad;

  return forceSnapshotByTurnPolicy ? 'snapshot' : null;
}
