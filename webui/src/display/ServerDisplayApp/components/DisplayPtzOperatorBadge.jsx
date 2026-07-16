// Display PTZ Operator Badge
// Purpose: Gives the physical /display page a simple, always-readable indicator
// for who currently owns the single PTZ camera turn.
// Scope: This is intentionally display-only chrome; PTZ ownership, naming, and
// permission rules stay in the server session state that every client already receives.
import { useSessionSelector } from '../../../context/SessionContext.jsx';

export default function DisplayPtzOperatorBadge() {
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const operatorLabel = String(ptz?.operatorLabel || '').trim();
  const visible = Boolean(ptz?.enabled && operatorLabel);

  return (
    <aside
      className={`pointer-events-none h-full shrink-0 overflow-hidden border-b border-l border-sky-200 bg-sky-700 transition-[width,opacity] duration-300 ease-out ${
        visible ? 'w-[min(34vw,34rem)] opacity-100' : 'w-0 opacity-0'
      }`}
      aria-hidden={!visible}
      aria-label={visible ? `PTZ operator ${operatorLabel}` : undefined}
    >
      {/*
        This is a flex-row segment instead of a fixed overlay so the online
        people marquee loses width when PTZ is active. That makes the badge feel
        like it enters from the right edge of the top bar while avoiding the
        previous problem where it covered content in the bottom-right corner.
      */}
      <div className="flex h-full min-w-0 items-center justify-center gap-[1vw] px-[1.2vw] text-[clamp(2.1rem,5.1vh,5.6rem)] font-black leading-none tracking-normal text-white">
        {/*
          The user explicitly requested uppercase "PTZ" here because the room
          display needs a terse, instantly recognizable camera marker. The name
          remains the larger variable part, and truncation prevents a long
          nickname from resizing the bar or overlapping the scrolling strip.
        */}
        <span className="shrink-0 text-sky-100">PTZ</span>
        <span className="min-w-0 truncate">{operatorLabel}</span>
      </div>
    </aside>
  );
}
