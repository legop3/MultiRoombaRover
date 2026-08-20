// Empty Driver Video Notice
// Purpose: Explains either an ordinary unassigned state or the recent reason a rover assignment was removed.
// Scope: Owns only the centered notice content; each video layout remains responsible for its own stage dimensions and framing.
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSharedClock } from '../../hooks/useSharedClock.js';

const REMOVAL_NOTICE_VISIBLE_MS = 2 * 60 * 1000;

export default function EmptyDriverVideoNotice() {
  const removalNotice = useSessionSelector((state) => state.roverRemovalNotice || null);
  const now = useSharedClock(1000, Boolean(removalNotice?.receivedAt));
  const noticeAgeMs = removalNotice?.receivedAt ? now - removalNotice.receivedAt : Infinity;

  /*
    A forced removal needs to explain itself where the video was, because the
    following session sync can only report that no rover is assigned. Keeping
    the message for a bounded period preserves that context without allowing an
    old moderation or safety notice to describe an unrelated later wait.
  */
  const showRemovalNotice = Boolean(
    removalNotice?.message && noticeAgeMs <= REMOVAL_NOTICE_VISIBLE_MS,
  );
  const title = showRemovalNotice
    ? removalNotice.title || 'Removed from rover'
    : 'No rover assigned';
  const message = showRemovalNotice
    ? removalNotice.message
    : 'You are not currently assigned to a rover.';

  return (
    <div className="flex h-full w-full items-center justify-center p-4 text-center">
      <div
        className={`mx-auto flex max-w-md flex-col gap-1 rounded border px-4 py-3 ${
          showRemovalNotice
            ? 'border-amber-300/60 bg-amber-950/35 text-amber-50'
            : 'border-slate-700/70 bg-slate-950/35 text-slate-300'
        }`}
      >
        <div className={showRemovalNotice ? 'text-sm font-semibold text-amber-100' : 'text-sm font-semibold text-slate-200'}>
          {title}
        </div>
        <div className={showRemovalNotice ? 'text-sm text-amber-50/90' : 'text-sm text-slate-400'}>
          {message}
        </div>
      </div>
    </div>
  );
}
