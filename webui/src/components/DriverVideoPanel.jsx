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

  return (
    <section className="rounded-sm bg-[#242a32] p-1">
      {roverId ? (
        <div className="lg:min-h-[70vh]">
          <VideoTile
            sessionInfo={info}
            label={roverId}
            muted={false}
            telemetryFrame={frame}
            batteryConfig={batteryConfig}
          />
        </div>
      ) : (
        <p className="text-sm text-slate-400">Assign a rover to view the video feed.</p>
      )}
    </section>
  );
}
