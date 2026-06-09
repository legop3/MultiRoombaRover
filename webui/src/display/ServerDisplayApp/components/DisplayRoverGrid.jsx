// Display Rover Grid
// Purpose: Fills the central 16:10 display band with rover driver/battery cells.
// Scope: Keeps rover status presentation dense and label-free for room readability.
import DisplayRoverCell from './DisplayRoverCell.jsx';
import { gridClassForRoverCount } from '../utils.js';

export default function DisplayRoverGrid({ roster = [], session }) {
  if (!roster.length) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center border-b border-slate-800 bg-black text-[clamp(2.5rem,7vh,7rem)] font-black text-slate-500">
        No rovers
      </section>
    );
  }

  return (
    <section className={`grid h-full min-h-0 ${gridClassForRoverCount(roster.length)} auto-rows-fr gap-0.5 bg-slate-950 p-0.5`}>
      {roster.map((rover) => (
        <DisplayRoverCell key={rover.id} rover={rover} session={session} />
      ))}
    </section>
  );
}
