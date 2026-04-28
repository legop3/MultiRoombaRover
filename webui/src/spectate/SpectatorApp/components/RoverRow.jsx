// Rover grid row for spectator view.
import RoverSpectatorCard from './RoverSpectatorCard.jsx';

export default function RoverRow({ roster, frames, videoSources, snapshotFeeds, audioSources, session, canSpectateVideo }) {
  if (roster.length === 0) {
    return <p className="col-span-full text-slate-400">No rovers registered.</p>;
  }
  return (
    <section className="grid grid-cols-1 gap-0.5 md:grid-cols-2">
      {roster.map((rover) => (
        <RoverSpectatorCard
          key={rover.id}
          rover={rover}
          frame={frames[rover.id]}
          sessionInfo={canSpectateVideo ? videoSources[rover.id] || null : null}
          videoMode={canSpectateVideo ? 'whep' : 'snapshot'}
          snapshotFeed={canSpectateVideo ? null : snapshotFeeds[rover.id]}
          audioInfo={audioSources[`${rover.id}-audio`]}
          session={session}
          showHudMap
          hudMapPosition="bottom-left"
        />
      ))}
    </section>
  );
}
