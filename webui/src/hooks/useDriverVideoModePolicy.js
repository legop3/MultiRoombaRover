import { useEffect, useMemo, useState } from 'react';
import { useSessionSelector } from '../context/SessionContext.jsx';

export function useDriverVideoModePolicy(roverId) {
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const users = useSessionSelector((state) => state.session?.users ?? []);
  const turnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const activeDrivers = useSessionSelector((state) => state.session?.activeDrivers ?? {});
  const [now, setNow] = useState(() => Date.now());

  const turnInfo = roverId ? turnQueues?.[roverId] || null : null;
  const activeDriverId = roverId ? activeDrivers?.[roverId] || null : null;
  const isActiveDriver = Boolean(socketId && activeDriverId === socketId);
  const nextDriverId = useMemo(() => {
    const queue = turnInfo?.queue || [];
    if (!queue.length || !turnInfo?.current || queue.length <= 1) return null;
    const idx = queue.findIndex((id) => id === turnInfo.current);
    if (idx === -1) return queue[0] || null;
    return queue[(idx + 1) % queue.length] || null;
  }, [turnInfo?.queue, turnInfo?.current]);
  const isNextDriver = Boolean(socketId && nextDriverId === socketId);
  const deadline = turnInfo?.deadline || null;
  const msUntilTurn = deadline ? deadline - now : null;
  const isTurnsMode = mode === 'turns';
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
  const shouldUsePreviewByLoad = isTurnsMode && totalDrivers > totalRovers;
  const isPreSwitchWindow =
    isTurnsMode && isNextDriver && msUntilTurn != null && msUntilTurn <= 5000 && msUntilTurn > 0;
  const showNotTurnNotice = isTurnsMode && !isActiveDriver;
  const forceSnapshotByTurnPolicy = showNotTurnNotice && !isPreSwitchWindow && shouldUsePreviewByLoad;

  useEffect(() => {
    if (mode !== 'turns') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [mode]);

  return forceSnapshotByTurnPolicy ? 'snapshot' : null;
}
