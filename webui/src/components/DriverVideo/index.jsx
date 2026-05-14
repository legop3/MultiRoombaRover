import { useSessionSelector } from '../../context/SessionContext.jsx';
import RoverMediaPlayer from '../RoverMediaPlayer/index.jsx';
import { useControlSystem } from '../../controls/index.js';
import { useDriverVideoModePolicy } from '../../hooks/useDriverVideoModePolicy.js';
import TurnsOverlay from '../HudOverlays/TurnsOverlay/index.jsx';
import HudOverlay from '../HudOverlays/HudOverlay/index.jsx';
import RoverDescriptionOverlay from '../HudOverlays/RoverDescriptionOverlay/index.jsx';
import OvercurrentOverlay from '../HudOverlays/OvercurrentOverlay/index.jsx';
import LowBatteryOverlay from '../HudOverlays/LowBatteryOverlay/index.jsx';
import DriverBottomStrip from '../HudOverlays/DriverBottomStrip/index.jsx';
import HudChatInput from '../HudOverlays/HudChatInput/index.jsx';

export default function DriverVideo({ layoutFormat = 'desktop' }) {
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const videoMode = useDriverVideoModePolicy(roverId);
  const {
    state: { lastControlIntentAt },
  } = useControlSystem();

  if (!roverId) {
    return (
      <section className="panel">
        <div className="panel-muted content-center text-center text-sm text-slate-400 aspect-[4/3]">
          <p>You are not assigned to a rover.</p>
          <p className="mt-0">
            <a href="/spectate" className="text-blue-400 underline hover:text-blue-500">
              Click here to visit the spectator page.
            </a>
          </p>
        </div>
      </section>
    );
  }

  const mobileHud = layoutFormat !== 'desktop';
  return (
    <section className="panel">
      <div className="flex flex-col gap-0.5">
        <div className="relative w-full overflow-hidden bg-black aspect-[4/3]">
          <RoverMediaPlayer roverId={roverId} videoMode={videoMode} />
          <TurnsOverlay mobileHud={mobileHud} />
          <RoverDescriptionOverlay
            variant="default"
            mobileHud={mobileHud}
            controlIntentAt={lastControlIntentAt}
          />
          <HudOverlay
            layoutFormat={layoutFormat}
            variant="default"
            mobileHud={mobileHud}
            labelScale={1}
          />
          <HudChatInput compact={mobileHud} />
          <OvercurrentOverlay compact={mobileHud} />
          <LowBatteryOverlay compact={mobileHud} />
        </div>
        <DriverBottomStrip mobileHud={mobileHud} />
      </div>
    </section>
  );
}
