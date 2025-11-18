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
        <p className="panel-muted">Assign a rover to view the video feed.</p>
      )}
    </section>
  );
}
