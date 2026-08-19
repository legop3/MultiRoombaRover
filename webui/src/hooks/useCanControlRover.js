// Rover Control Availability
// Purpose: Mirrors the server turnService.canDrive rule for immediate, consistent UI disabling.
import { useSessionSelector } from '../context/SessionContext.jsx';

export function selectCanControlRover(state, roverId) {
  const session = state.session;
  if (!roverId || session?.role === 'spectator') return false;
  if (session?.mode !== 'turns') return true;

  const turnInfo = session?.turnQueues?.[roverId] || null;
  const queue = Array.isArray(turnInfo?.queue) ? turnInfo.queue : [];

  /* The server permits control when a turns queue is absent or contains at most
     one driver. Only a genuinely shared queue requires the active socket id.
     Keeping this exact ordering prevents initial session loading from disabling
     an otherwise uncontested rover. The server remains the final authority. */
  if (queue.length <= 1) return true;
  /* activeDrivers is the server's direct ownership map and can arrive before
     the richer queue snapshot during an initial load or reconnect. The queue
     field remains a compatibility fallback for intermediate payloads. */
  const activeDriverId = session?.activeDrivers?.[roverId] || turnInfo?.current || null;
  return Boolean(session?.socketId && activeDriverId === session.socketId);
}

export default function useCanControlRover(roverId) {
  return useSessionSelector((state) => selectCanControlRover(state, roverId));
}
