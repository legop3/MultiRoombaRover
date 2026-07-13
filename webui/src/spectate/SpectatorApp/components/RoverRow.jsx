// Rover Row
// Purpose: Defines the Rover Row module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import RoverSpectatorCard from './RoverSpectatorCard.jsx';
import PtzSpectatorCard from './PtzSpectatorCard.jsx';

export default function RoverRow({ roster }) {
  return (
    <section className="grid grid-cols-1 gap-0.5 md:grid-cols-2">
      {roster.length === 0 ? <p className="col-span-full text-slate-400">No rovers registered.</p> : null}
      {roster.map((rover) => (
        <RoverSpectatorCard key={rover.id} rover={rover} />
      ))}
      <PtzSpectatorCard />
    </section>
  );
}
