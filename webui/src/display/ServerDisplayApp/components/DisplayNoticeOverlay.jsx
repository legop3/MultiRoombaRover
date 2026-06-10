// Display Notice Overlay
// Purpose: Shows server-side room-control feedback as huge temporary display text.
// Scope: Listens only on the /display page so normal driver and spectator pages are not interrupted.
import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../../../context/SocketContext.jsx';

const DEFAULT_DURATION_MS = 4500;

function normalizeNotice(payload = {}) {
  const text = String(payload?.text || '').trim();
  if (!text) return null;
  const durationMs = Number.isFinite(Number(payload?.durationMs))
    ? Math.max(1200, Math.min(15000, Number(payload.durationMs)))
    : DEFAULT_DURATION_MS;
  return {
    id: payload?.id || `display-notice-${Date.now()}`,
    text,
    durationMs,
  };
}

export default function DisplayNoticeOverlay() {
  const socket = useSocket();
  const [notice, setNotice] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    function clearNoticeTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function handleNotice(payload = {}) {
      const next = normalizeNotice(payload);
      if (!next) return;
      // Home Assistant buttons can be pressed rapidly. The room display should
      // reflect the most recent confirmed action instead of queueing stale room
      // state messages after the action has already changed again.
      clearNoticeTimer();
      setNotice(next);
      timerRef.current = setTimeout(() => {
        setNotice((current) => (current?.id === next.id ? null : current));
        timerRef.current = null;
      }, next.durationMs);
    }

    socket.on('display:notice', handleNotice);
    return () => {
      clearNoticeTimer();
      socket.off('display:notice', handleNotice);
    };
  }, [socket]);

  if (!notice) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[130] flex items-center justify-center bg-black px-[4vw] py-[4vh]">
      <div className="max-w-[92vw] border-4 border-cyan-200 bg-slate-950 px-[3vw] py-[2.5vh] text-center">
        <div className="whitespace-pre-wrap text-[clamp(3.2rem,11vh,11rem)] font-black leading-[0.95] text-white">
          {notice.text}
        </div>
      </div>
    </div>
  );
}
