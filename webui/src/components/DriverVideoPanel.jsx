import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import VideoTile from './VideoTile.jsx';

export default function DriverVideoPanel() {
  const { session } = useSession();
  const roverId = session?.assignment?.roverId;
  const sources = useVideoRequests(roverId ? [roverId] : []);
  const info = roverId ? sources[roverId] : null;
  const frame = useTelemetryFrame(roverId);
  const batteryRecord =
    roverId && session?.roster
      ? session.roster.find((item) => String(item.id) === String(roverId))
      : null;
  const batteryConfig = batteryRecord?.battery ?? null;

  const roverLabel = batteryRecord?.name || (roverId ? `Rover ${roverId}` : '');

  return (
    <section className="panel">
      {roverId ? (
        <VideoTile sessionInfo={info} label={roverLabel} telemetryFrame={frame} batteryConfig={batteryConfig} />
      ) : (
        <div className="panel-muted content-center text-center text-sm text-slate-400 aspect-video">
          <p>You are not assigned to a rover.</p>
          {/* colored button to visit the spectator page */}
          <p className="mt-2">
            <a href="/spectate" className="text-blue-400 underline hover:text-blue-500">
              Click here to visit the spectator page.
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
