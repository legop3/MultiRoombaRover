// Rover Spectator Card
// Purpose: Defines the Rover Spectator Card module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import SpectateVideo from '../../../components/SpectateVideo/index.jsx';

export default function RoverSpectatorCard({ rover }) {
  return (
    <article className="min-h-[16rem] rounded bg-zinc-900 p-0 sm:min-h-[18rem]">
      <div className="min-h-0 overflow-hidden rounded bg-black/20">
        <SpectateVideo
          roverId={rover.id}
          label={rover.name}
        />
      </div>
    </article>
  );
}
