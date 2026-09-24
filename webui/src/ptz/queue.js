import { useCallback } from 'react';
import { useSessionSelector } from '../context/SessionContext.jsx';

function normalizePtzQueue(ptz = null) {
  /*
    The PTZ service exposes the current operator separately from the waiting
    queue, while the rover queue row expects one ordered queue plus a current id.
    Normalizing once keeps every PTZ surface consistent with the shared queue
    renderer without making that renderer understand PTZ service internals.
  */
  const currentId = ptz?.operatorSocketId || null;
  const waiting = Array.isArray(ptz?.queue)
    ? ptz.queue.map((entry) => entry?.socketId || entry).filter(Boolean)
    : [];
  const queue = currentId ? [currentId, ...waiting.filter((id) => id !== currentId)] : waiting;
  const nextId = currentId ? waiting[0] || null : queue[0] || null;
  return { queue, currentId, nextId };
}

function usePtzQueueLookup(ptz = null) {
  const users = useSessionSelector((state) => state.session?.users ?? []);
  return useCallback(
    (socketId) => {
      const fromUsers = users.find((entry) => entry.socketId === socketId);
      if (fromUsers) return fromUsers;
      if (ptz?.operatorSocketId === socketId) {
        return { socketId, nickname: ptz?.operatorLabel || null, role: null };
      }
      const fromQueue = Array.isArray(ptz?.queue)
        ? ptz.queue.find((entry) => (entry?.socketId || entry) === socketId)
        : null;
      return {
        socketId,
        nickname: fromQueue?.label || null,
        role: null,
      };
    },
    [ptz, users],
  );
}

export { normalizePtzQueue, usePtzQueueLookup };
