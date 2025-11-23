import { useEffect, useMemo, useRef } from 'react';
import turnSound from '../assets/turn_alert.mp3';
import { useSession } from '../context/SessionContext.jsx';

function useAudio(src) {
  const audioRef = useRef(null);
  useEffect(() => {
    audioRef.current = new Audio(src);
    audioRef.current.load();
  }, [src]);
  const play = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  };
  return play;
}

export default function TurnAlertListener() {
  const { session, pushAlert } = useSession();
  const playSound = useAudio(turnSound);
  const seenRoversRef = useRef(new Set());

  const assignments = useMemo(() => session?.turnQueues || {}, [session?.turnQueues]);
  const socketId = session?.socketId || null;

  useEffect(() => {
    if (!socketId) return;
    const newlyMine = [];
    Object.entries(assignments).forEach(([roverId, info]) => {
      if (!info || !info.current || info.current !== socketId) return;
      if (!seenRoversRef.current.has(roverId)) {
        newlyMine.push(roverId);
        seenRoversRef.current.add(roverId);
      }
    });
    Object.keys(assignments).forEach((roverId) => {
      if (!assignments[roverId] || assignments[roverId].current !== socketId) {
        seenRoversRef.current.delete(roverId);
      }
    });
    if (newlyMine.length === 0) return;
    newlyMine.forEach((roverId) => {
      const roverName = session?.roster?.find((r) => String(r.id) === String(roverId))?.name || roverId;
      pushAlert({
        title: 'Your turn!',
        message: `You now control ${roverName}.`,
        color: 'success',
      });
    });
    playSound();
  }, [assignments, playSound, pushAlert, session?.roster, socketId]);

  return null;
}
