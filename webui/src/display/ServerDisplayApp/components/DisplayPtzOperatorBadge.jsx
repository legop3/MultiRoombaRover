// Display PTZ Operator Badge
// Purpose: Gives the physical /display page a simple, always-readable indicator
// for who currently owns the single PTZ camera turn.
// Scope: This is intentionally display-only chrome; PTZ ownership, naming, and
// permission rules stay in the server session state that every client already receives.
import { useSessionSelector } from '../../../context/SessionContext.jsx';

export default function DisplayPtzOperatorBadge() {
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const operatorLabel = String(ptz?.operatorLabel || '').trim();

  if (!ptz?.enabled || !operatorLabel) {
    /*
      The display should stay clean when nobody has the camera. Returning null
      instead of showing "none" makes the badge behave like a popup: it appears
      only for an active PTZ operator and disappears as soon as the turn ends.
    */
    return null;
  }

  return (
    <aside
      className="pointer-events-none fixed bottom-[2vh] right-[2vw] z-[90] max-w-[42vw] border-4 border-sky-200 bg-sky-700 px-[1.4vw] py-[1vh] text-center shadow-[0_0_2rem_rgba(14,165,233,0.45)]"
      aria-label={`PTZ operator ${operatorLabel}`}
    >
      {/*
        The label is deliberately short because /display is a room board, not a
        control panel. The large name is the useful information from across the
        room, while the smaller prefix prevents the blue box from being mistaken
        for a rover driver or chat message.
      */}
      <div className="text-[clamp(0.9rem,2.2vh,2rem)] font-black tracking-normal text-sky-100">
        Ptz camera
      </div>
      <div className="truncate text-[clamp(1.8rem,5vh,5rem)] font-black leading-none text-white">
        {operatorLabel}
      </div>
    </aside>
  );
}
