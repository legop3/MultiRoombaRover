import { useMemo } from 'react';
import { useSessionSelector } from '../context/SessionContext.jsx';
import { useSharedClock } from './useSharedClock.js';

export function useDriverVideoModePolicy(roverId) {
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const users = useSessionSelector((state) => state.session?.users ?? []);
  const turnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const activeDrivers = useSessionSelector((state) => state.session?.activeDrivers ?? {});
  const nonTurnVideoPolicy = useSessionSelector(
    (state) => state.session?.bandwidthSavings?.nonTurnVideo || 'snapshots',
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
  const totalRovers = roster.length;
  const totalDrivers = useMemo(() => {
    const unique = new Set();
    users.forEach((entry) => {
      const role = String(entry?.role || '');
      if (role === 'spectator') return;
      const turnRoverId = String(entry?.roverId || '').trim();
      const turnSocketId = String(entry?.socketId || '').trim();
      if (!turnRoverId || !turnSocketId) return;
      unique.add(turnSocketId);
    });
    return unique.size;
  }, [users]);
  /*
    The server sends the bandwidth policy because the same rule is enforced in
    video authorization. The hook only mirrors that policy so the UI avoids
    requesting live video when snapshots are the intended non-turn experience.
  */
  const shouldUsePreviewByLoad =
    nonTurnVideoPolicy === 'snapshots' && isTurnsMode && totalDrivers > totalRovers;
  const isPreSwitchWindow =
    isTurnsMode && isNextDriver && msUntilTurn != null && msUntilTurn <= 5000 && msUntilTurn > 0;
  const showNotTurnNotice = isTurnsMode && !isActiveDriver;
  const forceSnapshotByTurnPolicy = showNotTurnNotice && !isPreSwitchWindow && shouldUsePreviewByLoad;

  return forceSnapshotByTurnPolicy ? 'snapshot' : null;
}
