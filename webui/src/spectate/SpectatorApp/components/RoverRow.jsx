// Rover Row
// Purpose: Defines the Rover Row module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import RoverSpectatorCard from './RoverSpectatorCard.jsx';
import PtzSpectatorCard from './PtzSpectatorCard.jsx';

export default function RoverRow({ roster, showRovers = true, showPtz = true }) {
  return (
    <section className="grid grid-cols-1 gap-0.5 md:grid-cols-2">
      {showRovers && roster.length === 0 ? <p className="col-span-full text-slate-400">No rovers registered.</p> : null}
      {showRovers
        ? roster.map((rover) => (
            <RoverSpectatorCard key={rover.id} rover={rover} />
          ))
        : null}
      {/*
        PTZ intentionally remains the last grid item. With three rovers it
        therefore occupies the fourth tile, preserving the spectator layout's
        designed visual balance while still allowing independent unmounting.
      */}
      {showPtz ? <PtzSpectatorCard /> : null}
    </section>
  );
}
