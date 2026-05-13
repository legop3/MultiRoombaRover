// Rover Spectator Card
// Purpose: Defines the Rover Spectator Card module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import VideoTile from '../../../components/VideoTile/index.jsx';
import { formatDriverLabel } from '../utils.js';

export default function RoverSpectatorCard({ rover, frame, sessionInfo, videoMode, snapshotFeed, audioInfo, session }) {
  const driverLabel = formatDriverLabel({ roverId: rover.id, session });
  return (
    <article className="min-h-[16rem] rounded bg-zinc-900 p-0 sm:min-h-[18rem]">
      <div className="min-h-0 overflow-hidden rounded bg-black/20">
        <VideoTile
          sessionInfo={sessionInfo}
          videoMode={videoMode}
          snapshotFeed={snapshotFeed}
          audioSessionInfo={audioInfo}
          label={rover.name}
          roverDescription={rover.description}
          roverColor={rover.color || null}
          telemetryFrame={frame}
          batteryConfig={rover.battery}
          hudVariant="spectator"
          driverLabel={driverLabel}
          hudForceMap
          hudMapPosition="top-center"
        />
      </div>
    </article>
  );
}
