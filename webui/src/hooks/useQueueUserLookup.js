import { useCallback } from 'react';
import { useSessionSelector } from '../context/SessionContext.jsx';

export default function useQueueUserLookup(turn, usersOverride) {
  const localUsers = useSessionSelector((state) => state.session?.users);
  const users = usersOverride || localUsers;
  return useCallback((socketId) => users?.find((user) => user.socketId === socketId)
    || { socketId, nickname: turn?.userLabels?.[socketId] || null, role: null },
  [users, turn?.userLabels]);
}
